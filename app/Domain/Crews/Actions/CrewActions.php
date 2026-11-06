<?php

declare(strict_types=1);

namespace App\Domain\Crews\Actions;

use App\Domain\Aircraft\Enums\Station;
use App\Domain\Crews\Enums\CrewStatus;
use App\Domain\Crews\Enums\CrewVisibility;
use App\Domain\Crews\Events\CrewReady;
use App\Domain\Crews\Events\SeatClaimed;
use App\Domain\Crews\Models\Crew;
use App\Domain\Crews\Models\CrewMember;
use App\Domain\FlightSessions\Enums\FlightSessionStatus;
use App\Domain\FlightSessions\Models\FlightSession;
use App\Domain\FlightSessions\Models\FlightSessionParticipant;
use App\Domain\Missions\Models\Mission;
use App\Models\User;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpKernel\Exception\ConflictHttpException;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * Лобби экипажа (раздел 11): создание, вход по коду, места, готовность.
 * Занятие места — в транзакции с блокировкой строки экипажа; второй претендент получает 409.
 */
final class CrewActions
{
    public function create(User $owner, Mission $mission, CrewVisibility $visibility, int $maxPlayers, ?string $name = null): Crew
    {
        return DB::transaction(function () use ($owner, $mission, $visibility, $maxPlayers, $name): Crew {
            $crew = Crew::query()->create([
                'name' => $name ?? ($owner->pilotProfile->callsign ?? $owner->name)."'s crew",
                'owner_id' => $owner->id,
                'invite_code' => InviteCode::generate(),
                'visibility' => $visibility,
                'max_players' => $maxPlayers,
                'status' => CrewStatus::Lobby,
                'mission_id' => $mission->id,
            ]);

            $this->addMember($crew, $owner);

            return $crew;
        });
    }

    public function join(User $user, string $inviteCode): Crew
    {
        return DB::transaction(function () use ($user, $inviteCode): Crew {
            $crew = Crew::query()->where('invite_code', InviteCode::normalize($inviteCode))->lockForUpdate()->first();

            if ($crew === null) {
                throw new HttpException(404, __('crew.error.not_found'));
            }

            if ($crew->hasMember($user)) {
                return $crew;
            }

            if ($crew->status === CrewStatus::Closed) {
                throw new ConflictHttpException(__('crew.error.closed'));
            }

            if ($crew->members()->count() >= $crew->max_players) {
                throw new ConflictHttpException(__('crew.error.full'));
            }

            $this->addMember($crew, $user);
            CrewReady::dispatch($crew->refresh());

            return $crew;
        });
    }

    /**
     * Занять место. В лобби — только свободное; в вылете — свободное или занятое ИИ
     * (за отключившимся игроком место держится 120 с).
     */
    public function claimSeat(Crew $crew, User $user, Station $seat): CrewMember
    {
        try {
            $member = DB::transaction(function () use ($crew, $user, $seat): CrewMember {
                $locked = Crew::query()->whereKey($crew->id)->lockForUpdate()->firstOrFail();
                $member = $locked->members()->where('user_id', $user->id)->first();

                if ($member === null) {
                    throw new HttpException(403, __('crew.error.not_member'));
                }

                if ($locked->status === CrewStatus::Closed) {
                    throw new ConflictHttpException(__('crew.error.closed'));
                }

                if ($member->seat === $seat) {
                    return $member;
                }

                $holder = $locked->members()->where('seat', $seat->value)->first();

                if ($holder !== null) {
                    $stale = $locked->status === CrewStatus::InSession && ! $holder->seenWithin(CrewMember::SEAT_HOLD_SECONDS);

                    if (! $stale) {
                        throw new ConflictHttpException(__('crew.error.seat_taken'));
                    }

                    $holder->update(['seat' => null, 'is_ready' => false]);
                }

                $previous = $member->seat;

                $member->update(['seat' => $seat, 'is_ready' => false, 'last_seen_at' => now()]);

                if ($locked->status === CrewStatus::InSession) {
                    $this->moveParticipant($locked, $user, $previous, $seat);
                }

                return $member;
            });
        } catch (UniqueConstraintViolationException) {
            // Параллельный запрос успел раньше: частичный уникальный индекс (crew_id, seat).
            throw new ConflictHttpException(__('crew.error.seat_taken'));
        }

        SeatClaimed::dispatch($crew->refresh(), $user->id, $seat->value);

        return $member;
    }

    public function releaseSeat(Crew $crew, User $user, Station $seat): void
    {
        $member = $crew->memberFor($user);

        if ($member === null || $member->seat !== $seat) {
            return;
        }

        $member->update(['seat' => null, 'is_ready' => false]);
        SeatClaimed::dispatch($crew->refresh(), $user->id, null);
    }

    public function setReady(Crew $crew, User $user, bool $ready): CrewMember
    {
        $member = $crew->memberFor($user);

        if ($member === null) {
            throw new HttpException(403, __('crew.error.not_member'));
        }

        if ($ready && $member->seat === null) {
            throw new ConflictHttpException(__('crew.error.no_seat'));
        }

        $member->update(['is_ready' => $ready]);
        CrewReady::dispatch($crew->refresh());

        return $member;
    }

    /**
     * @param  array{difficulty?: string, host_user_id?: int|null}  $settings
     */
    public function configure(Crew $crew, User $owner, array $settings): Crew
    {
        if ($crew->owner_id !== $owner->id) {
            throw new HttpException(403, __('crew.error.not_owner'));
        }

        if (array_key_exists('host_user_id', $settings) && $settings['host_user_id'] !== null && ! $crew->members()->where('user_id', $settings['host_user_id'])->exists()) {
            throw new HttpException(422, __('crew.error.not_member'));
        }

        $crew->fill($settings)->save();
        CrewReady::dispatch($crew->refresh());

        return $crew;
    }

    public function leave(Crew $crew, User $user): void
    {
        $crew->members()->where('user_id', $user->id)->delete();

        if ($crew->members()->count() === 0) {
            $crew->update(['status' => CrewStatus::Closed]);

            return;
        }

        if ($crew->owner_id === $user->id) {
            $next = $crew->members()->orderBy('joined_at')->firstOrFail();

            $crew->update(['owner_id' => $next->user_id]);
        }

        CrewReady::dispatch($crew->refresh());
    }

    /** Отметка присутствия и RTT (лобби и вылет): основа выбора хоста и удержания места. */
    public function heartbeat(Crew $crew, User $user, ?int $rttMs): ?CrewMember
    {
        $member = $crew->memberFor($user);

        $member?->update(['rtt_ms' => $rttMs ?? $member->rtt_ms, 'last_seen_at' => now()]);

        return $member;
    }

    private function addMember(Crew $crew, User $user): CrewMember
    {
        return $crew->members()->create(['user_id' => $user->id, 'joined_at' => now(), 'last_seen_at' => now()]);
    }

    /** Переход между станциями во время вылета: закрыть прежний период, открыть новый. */
    private function moveParticipant(Crew $crew, User $user, ?Station $from, Station $to): void
    {
        $session = FlightSession::query()
            ->where('crew_id', $crew->id)
            ->whereIn('status', [FlightSessionStatus::Briefing, FlightSessionStatus::Active])
            ->latest('id')
            ->first();

        if ($session === null) {
            return;
        }

        $session->participants()->where('user_id', $user->id)->whereNull('left_at')->update(['left_at' => now()]);
        $session->participants()->where('seat', $to->value)->where('is_ai', true)->whereNull('left_at')->update(['left_at' => now()]);

        FlightSessionParticipant::query()->create([
            'flight_session_id' => $session->id,
            'user_id' => $user->id,
            'seat' => $to,
            'is_ai' => false,
            'joined_at' => now(),
        ]);

        if ($from !== null) {
            FlightSessionParticipant::query()->create([
                'flight_session_id' => $session->id,
                'user_id' => null,
                'seat' => $from,
                'is_ai' => true,
                'joined_at' => now(),
            ]);
        }
    }
}
