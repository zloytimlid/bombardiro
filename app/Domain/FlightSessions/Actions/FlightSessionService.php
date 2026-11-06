<?php

declare(strict_types=1);

namespace App\Domain\FlightSessions\Actions;

use App\Domain\Aircraft\Enums\Station;
use App\Domain\Aircraft\Models\AircraftType;
use App\Domain\Campaigns\Models\CampaignProgress;
use App\Domain\Crews\Enums\CrewStatus;
use App\Domain\Crews\Models\Crew;
use App\Domain\Crews\Models\CrewMember;
use App\Domain\Flights\Actions\FlightService;
use App\Domain\Flights\Models\Flight;
use App\Domain\FlightSessions\Data\Net\NetBootstrapData;
use App\Domain\FlightSessions\Data\Net\NetEventBatchData;
use App\Domain\FlightSessions\Data\Net\NetFinishData;
use App\Domain\FlightSessions\Data\Net\NetSeatData;
use App\Domain\FlightSessions\Data\Net\NetSnapshotData;
use App\Domain\FlightSessions\Enums\FlightSessionStatus;
use App\Domain\FlightSessions\Events\HostChanged;
use App\Domain\FlightSessions\Events\SessionStarted;
use App\Domain\FlightSessions\Jobs\ComputeDebrief;
use App\Domain\FlightSessions\Models\FlightSession;
use App\Domain\FlightSessions\Models\FlightSessionParticipant;
use App\Domain\FlightSessions\Support\Protocol;
use App\Domain\Missions\Models\Mission;
use App\Models\User;
use Illuminate\Cache\Lock;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpKernel\Exception\ConflictHttpException;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * Жизненный цикл вылета (разделы 9.1, 9.3, 11): старт с заполнением мест ИИ и выбором хоста,
 * bootstrap, журнал событий, снапшоты для миграции, миграция хоста, завершение.
 */
final class FlightSessionService
{
    public function start(Crew $crew, User $owner): FlightSession
    {
        if ($crew->owner_id !== $owner->id) {
            throw new HttpException(403, __('crew.error.not_owner'));
        }

        // Экипаж в звене стартует только вместе со звеном (FlightService::start).
        if ($crew->flight_id !== null) {
            throw new ConflictHttpException(__('flight.error.start_from_flight'));
        }

        return $this->open($crew, random_int(1, 2_147_483_647), null);
    }

    /** Старт экипажа в составе звена: общий сид, место в строю — flight_slot экипажа. */
    public function startForFlight(Crew $crew, int $seed, Flight $flight): FlightSession
    {
        return $this->open($crew, $seed, $flight);
    }

    private function open(Crew $crew, int $seed, ?Flight $flight): FlightSession
    {
        return DB::transaction(function () use ($crew, $seed, $flight): FlightSession {
            $locked = Crew::query()->whereKey($crew->id)->lockForUpdate()->firstOrFail();

            if ($locked->status !== CrewStatus::Lobby) {
                throw new ConflictHttpException(__('crew.error.not_in_lobby'));
            }

            $members = $locked->members()->get();
            $seated = $members->filter(fn (CrewMember $m): bool => $m->seat !== null);

            if ($seated->isEmpty() || $seated->contains(fn (CrewMember $m): bool => ! $m->is_ready)) {
                throw new ConflictHttpException(__('crew.error.not_ready'));
            }

            $mission = Mission::latestPublished($locked->mission->slug) ?? $locked->mission;
            $host = $this->chooseHost($locked, $seated->all());

            $session = FlightSession::query()->create([
                'crew_id' => $locked->id,
                'mission_id' => $mission->id,
                'mission_version' => $mission->version,
                'seed' => $seed,
                'difficulty' => $locked->difficulty,
                'status' => FlightSessionStatus::Active,
                'host_user_id' => $host,
                'started_at' => now(),
                'flags' => [],
                'campaign_progress_id' => $locked->campaign_progress_id,
                'flight_id' => $flight?->id,
                'flight_slot' => $flight !== null ? $locked->flight_slot : null,
            ]);

            // Пустые места занимает ИИ (раздел 11: «заполнить пустые места ИИ»).
            foreach (Station::cases() as $station) {
                $member = $seated->first(fn (CrewMember $m): bool => $m->seat === $station);

                FlightSessionParticipant::query()->create([
                    'flight_session_id' => $session->id,
                    'user_id' => $member?->user_id,
                    'seat' => $station,
                    'is_ai' => $member === null,
                    'joined_at' => now(),
                ]);
            }

            $locked->update(['status' => CrewStatus::InSession]);
            Cache::put(Protocol::hostSeenKey($session->ulid), now()->getPreciseTimestamp(3) / 1000, Protocol::SNAPSHOT_TTL_SECONDS);

            DB::afterCommit(fn () => SessionStarted::dispatch($session));

            return $session;
        });
    }

    /**
     * Хост: выбранный владельцем, иначе игрок с наименьшим RTT (раздел 9.1).
     *
     * @param  array<int, CrewMember>  $candidates
     */
    private function chooseHost(Crew $crew, array $candidates): int
    {
        $ids = array_map(fn (CrewMember $m): int => $m->user_id, $candidates);

        if ($crew->host_user_id !== null && in_array($crew->host_user_id, $ids, true)) {
            return $crew->host_user_id;
        }

        usort($candidates, fn (CrewMember $a, CrewMember $b): int => ($a->rtt_ms ?? PHP_INT_MAX) <=> ($b->rtt_ms ?? PHP_INT_MAX));

        return $candidates[0]->user_id;
    }

    public function bootstrap(FlightSession $session, User $user): NetBootstrapData
    {
        $this->authorizeParticipant($session, $user);

        $session->loadMissing(['mission.theatre', 'crew']);
        $aircraft = AircraftType::query()->where('slug', 'b25j')->firstOrFail();
        $mission = $session->mission;
        $theatre = $mission->theatre;
        $member = $session->crew->memberFor($user);

        return new NetBootstrapData(
            v: Protocol::VERSION,
            session: $session->ulid,
            crew: $session->crew->ulid,
            status: $session->status->value,
            seed: $session->seed,
            difficulty: $session->difficulty,
            host_user_id: $session->host_user_id,
            user_id: $user->id,
            seat: $member?->seat?->value,
            roster: $this->roster($session),
            mission: $mission->definition,
            aircraft_config: $aircraft->config,
            theatre: $theatre->definition,
            theatre_name: $theatre->localizedName(app()->getLocale()),
            theatre_placeholder: $theatre->placeholder,
            max_time_scale: app()->isProduction() ? 4 : 16,
            // Кампания (этап 6): борт начинает вылет с неотремонтированными повреждениями.
            airframe_zones: $this->airframeZones($session),
            // Звено (этап 6): место в строю и вылеты других экипажей звена.
            flight: FlightService::describe($session),
        );
    }

    /**
     * @return array<string, float>
     */
    private function airframeZones(FlightSession $session): array
    {
        if ($session->campaign_progress_id === null) {
            return [];
        }

        $progress = CampaignProgress::query()->find($session->campaign_progress_id);

        return $progress === null ? [] : array_map(fn ($v): float => (float) $v, $progress->airframe_state['zones'] ?? []);
    }

    /**
     * Текущий состав: места игроков по crew_members, остальные — ИИ.
     *
     * @return list<NetSeatData>
     */
    public function roster(FlightSession $session): array
    {
        $members = $session->crew->members()->with('user.pilotProfile')->get()->filter(fn (CrewMember $m): bool => $m->seat !== null);
        $roster = [];

        foreach (Station::cases() as $station) {
            $member = $members->first(fn (CrewMember $m): bool => $m->seat === $station);

            $roster[] = new NetSeatData(
                seat: $station->value,
                user_id: $member?->user_id,
                callsign: $member === null ? null : ($member->user->pilotProfile->callsign ?? $member->user->name),
                is_ai: $member === null,
            );
        }

        return $roster;
    }

    public function heartbeat(FlightSession $session, User $user, ?int $rttMs): void
    {
        $this->authorizeParticipant($session, $user);

        $session->crew->members()->where('user_id', $user->id)->update(array_filter([
            'rtt_ms' => $rttMs,
            'last_seen_at' => now(),
        ], fn ($v) => $v !== null));

        if ($session->isHost($user)) {
            $this->touchHost($session);
        }
    }

    /** Пакет событий от хоста: вставка с пропуском уже принятых seq (идемпотентно). */
    public function appendEvents(FlightSession $session, User $user, NetEventBatchData $batch): int
    {
        $this->authorizeHost($session, $user);

        $rows = [];
        $now = now();

        foreach ($batch->events as $event) {
            $rows[] = [
                'flight_session_id' => $session->id,
                'seq' => $event->seq,
                'tick' => $event->tick,
                'type' => $event->type,
                'payload' => json_encode($event->payload ?? [], JSON_THROW_ON_ERROR),
                'created_at' => $now,
            ];
        }

        $inserted = $rows === [] ? 0 : DB::table('flight_session_events')->insertOrIgnore($rows);
        $last = (int) $session->events()->max('seq');

        $session->update(['last_seq' => $last]);
        $this->touchHost($session);

        return $inserted;
    }

    public function putSnapshot(FlightSession $session, User $user, NetSnapshotData $snapshot): void
    {
        $this->authorizeHost($session, $user);

        $current = Cache::get(Protocol::snapshotKey($session->ulid));

        // Не затираем более свежий снапшот запоздавшим запросом.
        if (is_array($current) && ($current['tick'] ?? -1) > $snapshot->tick) {
            return;
        }

        Cache::put(Protocol::snapshotKey($session->ulid), ['tick' => $snapshot->tick, 'state' => $snapshot->state ?? [], 'at' => now()->getPreciseTimestamp(3) / 1000], Protocol::SNAPSHOT_TTL_SECONDS);
        $this->touchHost($session);
    }

    /**
     * @return array{tick: int, state: array<string, mixed>, at: float}|null
     */
    public function getSnapshot(FlightSession $session, User $user): ?array
    {
        $this->authorizeParticipant($session, $user);

        /** @var array{tick: int, state: array<string, mixed>, at: float}|null */
        return Cache::get(Protocol::snapshotKey($session->ulid));
    }

    /**
     * Участник сообщил о потере хоста (ушёл из presence или нет снапшотов 3 с).
     * Сервер подтверждает молчание хоста и выбирает нового — с наименьшим RTT среди тех, кто на связи.
     */
    public function hostLost(FlightSession $session, User $reporter): FlightSession
    {
        $this->authorizeParticipant($session, $reporter);

        if (! $session->status->isOpen()) {
            return $session;
        }

        /** @var Lock $lock */
        $lock = Cache::lock("session:{$session->ulid}:migrate", 5);

        // Параллельные сообщения клиентов: ждать блокировку короткими шагами, а не по 250 мс.
        return $lock->betweenBlockedAttemptsSleepFor(50)->block(3, function () use ($session, $reporter): FlightSession {
            $session->refresh();
            $seen = (float) Cache::get(Protocol::hostSeenKey($session->ulid), 0);

            $silence = now()->getPreciseTimestamp(3) / 1000 - $seen;

            if ($silence < Protocol::HOST_SILENCE_SECONDS) {
                Log::info('host_lost_rejected', ['flight_session_id' => $session->ulid, 'reporter' => $reporter->id, 'silence_s' => round($silence, 2)]);

                return $session;
            }

            $candidates = $session->crew->members()
                ->whereNotNull('seat')
                ->where('user_id', '!=', $session->host_user_id ?? 0)
                ->where('last_seen_at', '>', now()->subSeconds(Protocol::CANDIDATE_SEEN_SECONDS))
                ->orderByRaw('rtt_ms IS NULL, rtt_ms ASC')
                ->get();

            $next = $candidates->first();

            if ($next === null) {
                Log::warning('host_lost_no_candidate', ['flight_session_id' => $session->ulid, 'reporter' => $reporter->id, 'silence_s' => round($silence, 2)]);

                return $session;
            }

            Log::info('host_elected', ['flight_session_id' => $session->ulid, 'reporter' => $reporter->id, 'from' => $session->host_user_id, 'to' => $next->user_id, 'silence_s' => round($silence, 2)]);

            $session->update(['host_user_id' => $next->user_id]);
            // Новому хосту — время загрузить снапшот и восстановить мир, иначе его сочтут пропавшим.
            $this->touchHost($session, Protocol::NEW_HOST_GRACE_SECONDS);
            HostChanged::dispatch($session, 'host_lost');

            return $session;
        });
    }

    public function finish(FlightSession $session, User $user, NetFinishData $data): FlightSession
    {
        $this->authorizeHost($session, $user);

        if ($session->status === FlightSessionStatus::Finished) {
            return $session;
        }

        $session->update([
            'status' => FlightSessionStatus::Finished,
            'ended_at' => now(),
            'outcome' => $data->outcome,
            'debrief' => ['summary' => $data->toArray()],
        ]);

        $session->participants()->whereNull('left_at')->update(['left_at' => now()]);
        $session->crew->update(['status' => CrewStatus::Lobby]);
        $session->crew->members()->update(['is_ready' => false]);

        ComputeDebrief::dispatch($session->id);

        return $session;
    }

    private function touchHost(FlightSession $session, float $graceSeconds = 0): void
    {
        $key = Protocol::hostSeenKey($session->ulid);
        // Отметка не уходит назад: пульс во время льготного срока нового хоста её не сокращает.
        $seen = max(now()->getPreciseTimestamp(3) / 1000 + $graceSeconds, (float) Cache::get($key, 0));

        Cache::put($key, $seen, Protocol::SNAPSHOT_TTL_SECONDS);
    }

    private function authorizeParticipant(FlightSession $session, User $user): void
    {
        if (! $session->crew->hasMember($user) && ! $session->isParticipant($user)) {
            throw new HttpException(403, __('crew.error.not_member'));
        }
    }

    private function authorizeHost(FlightSession $session, User $user): void
    {
        if (! $session->isHost($user)) {
            throw new HttpException(403, __('session.error.not_host'));
        }

        if (! $session->status->isOpen()) {
            throw new ConflictHttpException(__('session.error.closed'));
        }
    }
}
