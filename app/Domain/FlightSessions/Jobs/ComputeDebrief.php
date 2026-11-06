<?php

declare(strict_types=1);

namespace App\Domain\FlightSessions\Jobs;

use App\Domain\Campaigns\Actions\CampaignService;
use App\Domain\Campaigns\Models\CampaignProgress;
use App\Domain\FlightSessions\Events\DebriefReady;
use App\Domain\FlightSessions\Events\SessionEnded;
use App\Domain\FlightSessions\Models\FlightSession;
use App\Domain\FlightSessions\Support\DebriefCalculator;
use App\Domain\Progression\Jobs\AwardAchievements;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;

/**
 * Разбор вылета после посадки (раздел 13: готов ≤ 10 с). Считает итог по журналу,
 * проверяет правдоподобие и сообщает экипажу SessionEnded.
 */
final class ComputeDebrief implements ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    public function __construct(public int $sessionId) {}

    public function handle(DebriefCalculator $calculator, CampaignService $campaigns): void
    {
        $session = FlightSession::query()->findOrFail($this->sessionId);
        $result = $calculator->compute($session);
        $summary = $session->debrief['summary'] ?? [];

        $session->update([
            'debrief' => ['summary' => $summary, ...$result['debrief']],
            'score' => $result['score'],
            'outcome' => $result['outcome'],
            'flags' => $result['flags'],
            'verified' => $result['flags'] === [],
        ]);

        // Личные метрики — участникам по их местам.
        foreach ($session->participants()->whereNotNull('user_id')->get() as $participant) {
            $participant->update(['metrics' => $result['debrief']['stations'][$participant->seat->value] ?? null]);
        }

        if ($result['flags'] !== []) {
            Log::warning('Flight session flagged for moderation', ['flight_session_id' => $session->ulid, 'flags' => $result['flags']]);
        }

        $session->refresh();

        // Кампания (этап 6): состояние борта и экипажа переходит в следующий вылет.
        $progress = $session->campaign_progress_id !== null ? CampaignProgress::query()->find($session->campaign_progress_id) : null;

        if ($progress !== null && $progress->completed_at === null) {
            $campaigns->record($progress, $session, $summary);
        }

        SessionEnded::dispatch($session);
        DebriefReady::dispatch($session, $session->score, $session->verified);
        AwardAchievements::dispatch($session->id);
        BuildReplay::dispatch($session->id);
    }
}
