<?php

declare(strict_types=1);

namespace App\Domain\Campaigns\Actions;

use App\Domain\Campaigns\Models\Campaign;
use App\Domain\Campaigns\Models\CampaignProgress;
use App\Domain\Crews\Models\Crew;
use App\Domain\FlightSessions\Models\FlightSession;
use App\Domain\Missions\Models\Mission;
use Symfony\Component\HttpKernel\Exception\ConflictHttpException;

/**
 * Кампания (этап 6, раздел 7.3): повреждения сохраняются между вылетами и требуют времени на ремонт.
 * День ремонта восстанавливает долю прочности каждой зоны (rules.repair_per_day); вылет — тоже день.
 */
final class CampaignService
{
    public function enroll(Crew $crew, Campaign $campaign): CampaignProgress
    {
        $progress = CampaignProgress::query()->firstOrCreate(
            ['campaign_id' => $campaign->id, 'crew_id' => $crew->id],
            ['step' => 0, 'day' => 1, 'airframe_state' => ['zones' => []], 'crew_state' => [], 'history' => []],
        );

        $this->syncMission($crew, $progress);

        return $progress;
    }

    /** Миссия экипажа = текущий шаг кампании. */
    public function syncMission(Crew $crew, CampaignProgress $progress): void
    {
        $slug = $progress->currentMission();
        $mission = $slug === null ? null : Mission::latestPublished($slug);

        if ($mission !== null && $crew->mission_id !== $mission->id) {
            $crew->update(['mission_id' => $mission->id]);
        }
    }

    /** День ремонта без вылета. */
    public function repairDay(CampaignProgress $progress): CampaignProgress
    {
        if ($progress->completed_at !== null) {
            throw new ConflictHttpException(__('campaign.error.completed'));
        }

        $progress->update(['day' => $progress->day + 1, 'airframe_state' => ['zones' => $this->repaired($progress, 1)]]);

        return $progress;
    }

    /**
     * Итог вылета кампании: прочность зон из итога хоста, ранения, следующий шаг или повтор.
     *
     * @param  array<string, mixed>  $summary
     */
    public function record(CampaignProgress $progress, FlightSession $session, array $summary): CampaignProgress
    {
        $zones = is_array($summary['zones'] ?? null) ? $summary['zones'] : [];
        $clean = [];

        // Итог хоста — недоверенный ввод: только строковые зоны и числа 0…1.
        foreach ($zones as $zone => $share) {
            if (is_string($zone) && (is_int($share) || is_float($share))) {
                $clean[$zone] = round(max(0.0, min(1.0, (float) $share)), 3);
            }
        }

        $rules = $progress->campaign->rules;
        $advance = in_array($session->outcome, $rules['advance_on'], true);
        $step = $advance ? $progress->step + 1 : ($rules['retry_on_failure'] ? $progress->step : $progress->step + 1);
        /** @var list<array{station: string, health: string}> $crew */
        $crew = is_array($summary['crew'] ?? null) ? $summary['crew'] : [];

        $progress->update([
            'step' => $step,
            'day' => $progress->day + 1,
            'airframe_state' => ['zones' => $clean],
            'crew_state' => collect($crew)->mapWithKeys(fn (array $m): array => [$m['station'] => $m['health']])->all(),
            'history' => [...$progress->history, ['session' => $session->ulid, 'mission' => $session->mission->slug, 'outcome' => $session->outcome, 'score' => $session->score, 'day' => $progress->day]],
            'completed_at' => $step >= count($progress->campaign->missions) ? now() : null,
        ]);

        $this->syncMission($progress->crew, $progress);

        return $progress;
    }

    /**
     * Прочность зон после `days` дней ремонта.
     *
     * @return array<string, float>
     */
    public function repaired(CampaignProgress $progress, int $days): array
    {
        $rate = (float) ($progress->campaign->rules['repair_per_day']['value'] ?? 0.35);
        $out = [];

        foreach ($progress->airframe_state['zones'] ?? [] as $zone => $share) {
            $out[$zone] = round(min(1.0, (float) $share + $rate * $days), 3);
        }

        return array_filter($out, fn (float $v): bool => $v < 1.0);
    }
}
