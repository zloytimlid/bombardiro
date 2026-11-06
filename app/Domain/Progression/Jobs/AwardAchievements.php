<?php

declare(strict_types=1);

namespace App\Domain\Progression\Jobs;

use App\Domain\FlightSessions\Enums\FlightSessionStatus;
use App\Domain\FlightSessions\Models\FlightSession;
use App\Domain\FlightSessions\Models\FlightSessionParticipant;
use App\Domain\Progression\Models\Achievement;
use App\Domain\Progression\Models\PilotProfile;
use App\Domain\Progression\Models\UserAchievement;
use App\Domain\Progression\Support\AchievementRules;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\DB;

/**
 * После серверного разбора (раздел 11: AwardAchievements): статистика профиля и достижения
 * игрокам вылета. Один раз на вылет — `flight_sessions.awarded_at` под блокировкой строки.
 * Непроверенный вылет (verified = false) достижений не даёт, но в статистику налёта идёт.
 */
final class AwardAchievements implements ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    public function __construct(public int $sessionId) {}

    public function handle(): void
    {
        DB::transaction(function (): void {
            $session = FlightSession::query()->whereKey($this->sessionId)->lockForUpdate()->firstOrFail();

            if ($session->awarded_at !== null || $session->status !== FlightSessionStatus::Finished || ! is_array($session->debrief)) {
                return;
            }

            $session->forceFill(['awarded_at' => now()])->save();

            $participants = $session->participants()->whereNotNull('user_id')->orderBy('id')->get();
            $byUser = $participants->groupBy('user_id');
            $humans = $participants->pluck('seat')->unique()->count();
            $catalog = Achievement::query()->orderBy('sort')->get();
            $durationS = (int) ($session->debrief['durationS'] ?? 0);

            foreach ($byUser as $userId => $rows) {
                $profile = PilotProfile::query()->where('user_id', $userId)->first();

                if ($profile !== null) {
                    $profile->forceFill([
                        'missions_total' => $profile->missions_total + 1,
                        'flight_seconds_total' => $profile->flight_seconds_total + $durationS,
                    ])->save();
                }

                if (! $session->verified) {
                    continue;
                }

                /** @var FlightSessionParticipant $last */
                $last = $rows->last();
                $context = self::context($session, $last, $humans, $profile);

                foreach ($catalog as $achievement) {
                    if (AchievementRules::matches($achievement->criteria, $context)) {
                        UserAchievement::query()->insertOrIgnore([
                            'user_id' => (int) $userId,
                            'achievement_id' => $achievement->id,
                            'flight_session_id' => $session->id,
                            'unlocked_at' => now(),
                        ]);
                    }
                }
            }
        });
    }

    /**
     * @return array<string, mixed>
     */
    public static function context(FlightSession $session, FlightSessionParticipant $participant, int $humans, ?PilotProfile $profile): array
    {
        /** @var array<string, mixed> $d */
        $d = $session->debrief ?? [];
        /** @var list<array{health?: string}> $crew */
        $crew = $d['crew'] ?? [];
        $context = [
            'outcome' => $session->outcome,
            'verified' => $session->verified,
            'mission' => $session->mission->slug,
            'difficulty' => $session->difficulty,
            'seat' => $participant->seat->value,
            'score' => $session->score,
            'humans' => $humans,
            'wounded' => count(array_filter($crew, fn (array $m): bool => ($m['health'] ?? 'ok') !== 'ok')),
            'target.status' => $d['target']['status'] ?? null,
            'target.percent' => $d['target']['percent'] ?? null,
            'tot.within' => $d['timeOverTarget']['withinWindow'] ?? null,
            'profile.missions_total' => $profile?->missions_total,
        ];

        foreach ($participant->metrics ?? [] as $metric) {
            if (is_array($metric) && isset($metric['key']) && is_string($metric['key'])) {
                $context['station.'.$metric['key']] = $metric['value'] ?? null;
            }
        }

        return $context;
    }
}
