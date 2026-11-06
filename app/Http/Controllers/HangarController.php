<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Domain\FlightSessions\Models\FlightSessionParticipant;
use App\Domain\Missions\Models\Mission;
use App\Domain\Progression\Models\Achievement;
use App\Domain\Progression\Models\UserAchievement;
use App\Domain\Progression\Support\Leaderboard;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Ангар (раздел 12: профиль, статистика, достижения, история борта) и рейтинги (раздел 11).
 */
final class HangarController extends Controller
{
    public function show(): Response
    {
        $user = $this->authUser();
        $profile = $user->pilotProfile;
        $unlocked = UserAchievement::query()->where('user_id', $user->id)->pluck('unlocked_at', 'achievement_id');

        $history = FlightSessionParticipant::query()
            ->with('session.mission')
            ->where('user_id', $user->id)
            ->latest('id')
            ->limit(20)
            ->get()
            ->unique('flight_session_id')
            ->values()
            ->map(fn (FlightSessionParticipant $p): array => [
                'session' => $p->session->ulid,
                'mission' => $p->session->mission->title,
                'seat' => $p->seat->value,
                'status' => $p->session->status->value,
                'outcome' => $p->session->outcome,
                'score' => $p->session->score,
                'verified' => $p->session->verified,
                'date' => $p->session->started_at?->toDateString(),
            ])
            ->all();

        return Inertia::render('hangar/Show', [
            'profile' => $profile === null ? null : [
                'callsign' => $profile->callsign,
                'rank' => $profile->rank,
                'missions_total' => $profile->missions_total,
                'flight_hours' => round($profile->flight_seconds_total / 3600, 1),
                'preferred_seat' => $profile->preferred_seat?->value,
            ],
            'achievements' => Achievement::query()->orderBy('sort')->get()->map(fn (Achievement $a): array => [
                'slug' => $a->slug,
                'icon' => $a->icon,
                'title' => $a->title,
                'description' => $a->description,
                'unlocked_at' => isset($unlocked[$a->id]) ? (string) $unlocked[$a->id] : null,
            ])->all(),
            'history' => $history,
        ]);
    }

    public function leaderboardPage(): Response
    {
        return Inertia::render('leaderboards/Index', [
            'missions' => Mission::query()->where('is_published', true)->orderBy('id')->get(['slug', 'title'])->unique('slug')->values()->map(fn (Mission $m): array => ['slug' => $m->slug, 'title' => $m->title])->all(),
        ]);
    }

    public function leaderboard(Request $request): JsonResponse
    {
        $data = $request->validate([
            'mission' => ['required', 'string', 'exists:missions,slug'],
            'period' => ['sometimes', Rule::in(Leaderboard::PERIODS)],
        ]);

        return response()->json(['data' => Leaderboard::top($data['mission'], $data['period'] ?? 'all')]);
    }
}
