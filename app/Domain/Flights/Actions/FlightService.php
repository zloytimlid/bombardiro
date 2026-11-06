<?php

declare(strict_types=1);

namespace App\Domain\Flights\Actions;

use App\Domain\Crews\Enums\CrewStatus;
use App\Domain\Crews\Models\Crew;
use App\Domain\Crews\Models\CrewMember;
use App\Domain\Flights\Models\Flight;
use App\Domain\FlightSessions\Actions\FlightSessionService;
use App\Domain\FlightSessions\Models\FlightSession;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpKernel\Exception\ConflictHttpException;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * Звено до 4 экипажей (этап 6): ведущий экипаж создаёт звено, остальные входят по коду; старт —
 * один сид и одна миссия на всех, у каждого экипажа свой вылет (свой хост) и место в строю.
 */
final readonly class FlightService
{
    private const string ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

    public function __construct(private FlightSessionService $sessions) {}

    public function create(Crew $crew, User $owner): Flight
    {
        $this->authorizeOwnerInLobby($crew, $owner);

        if ($crew->flight_id !== null) {
            throw new ConflictHttpException(__('flight.error.already'));
        }

        return DB::transaction(function () use ($crew): Flight {
            $flight = Flight::query()->create(['invite_code' => $this->code(), 'leader_crew_id' => $crew->id, 'mission_id' => $crew->mission_id, 'status' => 'lobby']);

            $crew->update(['flight_id' => $flight->id, 'flight_slot' => 0]);

            return $flight;
        });
    }

    public function join(Crew $crew, User $owner, string $code): Flight
    {
        $this->authorizeOwnerInLobby($crew, $owner);

        return DB::transaction(function () use ($crew, $code): Flight {
            $flight = Flight::query()->where('invite_code', strtoupper(trim($code)))->lockForUpdate()->first();

            if ($flight === null) {
                throw new NotFoundHttpException(__('flight.error.not_found'));
            }

            if ($flight->status !== 'lobby') {
                throw new ConflictHttpException(__('flight.error.not_in_lobby'));
            }

            if ($crew->flight_id !== null && $crew->flight_id !== $flight->id) {
                throw new ConflictHttpException(__('flight.error.already'));
            }

            if ($crew->flight_id === $flight->id) {
                return $flight;
            }

            $taken = Crew::query()->where('flight_id', $flight->id)->pluck('flight_slot')->all();
            $slot = collect(range(0, Flight::MAX_CREWS - 1))->first(fn (int $s): bool => ! in_array($s, $taken, true));

            if ($slot === null) {
                throw new ConflictHttpException(__('flight.error.full'));
            }

            $leader = $flight->leader;

            $crew->update(['flight_id' => $flight->id, 'flight_slot' => $slot, 'mission_id' => $flight->mission_id, 'difficulty' => $leader->difficulty]);

            return $flight;
        });
    }

    public function leave(Crew $crew, User $owner): void
    {
        $this->authorizeOwnerInLobby($crew, $owner);

        DB::transaction(function () use ($crew): void {
            $flight = $crew->flight_id !== null ? Flight::query()->find($crew->flight_id) : null;

            if ($flight !== null && $flight->leader_crew_id === $crew->id) {
                Crew::query()->where('flight_id', $flight->id)->update(['flight_id' => null, 'flight_slot' => null]);
                $flight->update(['status' => 'closed']);

                return;
            }

            $crew->update(['flight_id' => null, 'flight_slot' => null]);
        });
    }

    /**
     * Старт звена ведущим: все экипажи в лобби и готовы; общий сид; вылет каждого экипажа.
     *
     * @return list<FlightSession>
     */
    public function start(Flight $flight, User $leaderOwner): array
    {
        if ($flight->leader->owner_id !== $leaderOwner->id) {
            throw new HttpException(403, __('crew.error.not_owner'));
        }

        return DB::transaction(function () use ($flight): array {
            $locked = Flight::query()->whereKey($flight->id)->lockForUpdate()->firstOrFail();

            if ($locked->status !== 'lobby') {
                throw new ConflictHttpException(__('flight.error.not_in_lobby'));
            }

            $crews = Crew::query()->where('flight_id', $locked->id)->orderBy('flight_slot')->get();

            foreach ($crews as $crew) {
                $seated = $crew->members()->whereNotNull('seat')->get();

                if ($crew->status !== CrewStatus::Lobby || $seated->isEmpty() || $seated->contains(fn (CrewMember $m): bool => ! $m->is_ready)) {
                    throw new ConflictHttpException(__('flight.error.not_ready', ['crew' => $crew->name]));
                }
            }

            $seed = random_int(1, 2_147_483_647);
            $locked->update(['status' => 'in_session', 'seed' => $seed]);

            return array_values($crews->map(fn (Crew $crew): FlightSession => $this->sessions->startForFlight($crew, $seed, $locked))->all());
        });
    }

    /**
     * Звено для bootstrap вылета: места в строю, экипажи и их вылеты.
     *
     * @return array{ulid: string, slot: int, slots: list<array{slot: int, crew: string, name: string, session: string|null}>}|null
     */
    public static function describe(FlightSession $session): ?array
    {
        if ($session->flight_id === null) {
            return null;
        }

        $flight = Flight::query()->find($session->flight_id);

        if ($flight === null) {
            return null;
        }

        $slots = FlightSession::query()->with('crew')->where('flight_id', $flight->id)->orderBy('flight_slot')->get()
            ->map(fn (FlightSession $s): array => ['slot' => (int) $s->flight_slot, 'crew' => $s->crew->ulid, 'name' => $s->crew->name, 'session' => $s->ulid])
            ->values()
            ->all();

        return ['ulid' => $flight->ulid, 'slot' => (int) $session->flight_slot, 'slots' => array_values($slots)];
    }

    private function authorizeOwnerInLobby(Crew $crew, User $owner): void
    {
        if ($crew->owner_id !== $owner->id) {
            throw new HttpException(403, __('crew.error.not_owner'));
        }

        if ($crew->status !== CrewStatus::Lobby) {
            throw new ConflictHttpException(__('crew.error.not_in_lobby'));
        }
    }

    private function code(): string
    {
        do {
            $code = '';

            for ($i = 0; $i < 8; $i++) {
                $code .= self::ALPHABET[random_int(0, strlen(self::ALPHABET) - 1)];
            }
        } while (Flight::query()->where('invite_code', $code)->exists());

        return $code;
    }
}
