<?php

declare(strict_types=1);

namespace App\Domain\Crews\Jobs;

use App\Domain\Crews\Enums\CrewStatus;
use App\Domain\Crews\Models\Crew;
use App\Domain\FlightSessions\Enums\FlightSessionStatus;
use App\Domain\FlightSessions\Models\FlightSession;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;

/**
 * Раздел 11, планировщик: каждые 15 минут закрывать брошенные лобби (никого на связи 2 ч)
 * и прерывать вылеты, у которых хост и все игроки молчат дольше 30 минут.
 */
final class CloseStaleCrews implements ShouldQueue
{
    use Queueable;

    public const int LOBBY_IDLE_MINUTES = 120;

    public const int SESSION_IDLE_MINUTES = 30;

    public function handle(): void
    {
        $lobbyCutoff = now()->subMinutes(self::LOBBY_IDLE_MINUTES);
        $closed = Crew::query()
            ->where('status', CrewStatus::Lobby)
            ->where('updated_at', '<', $lobbyCutoff)
            ->whereDoesntHave('members', fn ($q) => $q->where('last_seen_at', '>=', $lobbyCutoff))
            ->update(['status' => CrewStatus::Closed]);

        $sessionCutoff = now()->subMinutes(self::SESSION_IDLE_MINUTES);
        $stale = FlightSession::query()
            ->whereIn('status', [FlightSessionStatus::Briefing, FlightSessionStatus::Active])
            ->where('updated_at', '<', $sessionCutoff)
            ->whereDoesntHave('crew.members', fn ($q) => $q->where('last_seen_at', '>=', $sessionCutoff))
            ->get();

        foreach ($stale as $session) {
            $session->update(['status' => FlightSessionStatus::Aborted, 'ended_at' => now(), 'outcome' => 'aborted']);
            $session->crew()->update(['status' => CrewStatus::Lobby]);
        }

        Log::info('stale_crews_closed', ['lobbies' => $closed, 'sessions_aborted' => $stale->count()]);
    }
}
