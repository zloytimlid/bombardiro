<?php

declare(strict_types=1);

namespace App\Domain\Progression\Support;

use App\Domain\FlightSessions\Enums\FlightSessionStatus;
use App\Domain\FlightSessions\Models\FlightSession;
use App\Domain\FlightSessions\Models\FlightSessionParticipant;
use App\Domain\Missions\Models\Mission;

/**
 * Рейтинги (раздел 11: GET /api/leaderboards): лучшие вылеты по миссии и периоду, только verified.
 */
final class Leaderboard
{
    public const array PERIODS = ['week', 'month', 'all'];

    /**
     * @return list<array{rank: int, session: string, crew: string, score: int, outcome: string|null, difficulty: string, date: string|null, players: list<string>}>
     */
    public static function top(string $missionSlug, string $period, int $limit = 20): array
    {
        $missionIds = Mission::query()->where('slug', $missionSlug)->pluck('id');

        $query = FlightSession::query()
            ->with(['crew', 'participants.user.pilotProfile'])
            ->whereIn('mission_id', $missionIds)
            ->where('status', FlightSessionStatus::Finished)
            ->where('verified', true)
            ->whereNotNull('score')
            ->orderByDesc('score')
            ->orderBy('ended_at')
            ->limit($limit);

        if ($period === 'week') {
            $query->where('ended_at', '>=', now()->subWeek());
        } elseif ($period === 'month') {
            $query->where('ended_at', '>=', now()->subMonth());
        }

        $rows = [];

        foreach ($query->get()->values() as $i => $session) {
            $players = $session->participants
                ->filter(fn (FlightSessionParticipant $p): bool => $p->user !== null)
                ->map(fn (FlightSessionParticipant $p): string => $p->user?->pilotProfile->callsign ?? $p->user->name ?? '')
                ->unique()
                ->values()
                ->all();

            $rows[] = [
                'rank' => $i + 1,
                'session' => $session->ulid,
                'crew' => $session->crew->name,
                'score' => (int) $session->score,
                'outcome' => $session->outcome,
                'difficulty' => $session->difficulty,
                'date' => $session->ended_at?->toDateString(),
                'players' => array_values($players),
            ];
        }

        return $rows;
    }
}
