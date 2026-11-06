<?php

declare(strict_types=1);

namespace App\Domain\Campaigns\Models;

use App\Domain\Crews\Models\Crew;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * Прогресс экипажа в кампании: шаг (миссия), день, состояние борта (доля прочности зон 0…1)
 * и экипажа (ранения), история вылетов.
 *
 * @property int $id
 * @property int $campaign_id
 * @property int $crew_id
 * @property int $step
 * @property int $day
 * @property array{zones: array<string, float>} $airframe_state
 * @property array<string, string> $crew_state
 * @property list<array<string, mixed>> $history
 * @property Carbon|null $completed_at
 * @property-read Campaign $campaign
 * @property-read Crew $crew
 */
#[Fillable(['campaign_id', 'crew_id', 'step', 'day', 'airframe_state', 'crew_state', 'history', 'completed_at'])]
class CampaignProgress extends Model
{
    protected $table = 'campaign_progress';

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['airframe_state' => 'array', 'crew_state' => 'array', 'history' => 'array', 'completed_at' => 'datetime'];
    }

    /**
     * @return BelongsTo<Campaign, $this>
     */
    public function campaign(): BelongsTo
    {
        return $this->belongsTo(Campaign::class);
    }

    /**
     * @return BelongsTo<Crew, $this>
     */
    public function crew(): BelongsTo
    {
        return $this->belongsTo(Crew::class);
    }

    public function currentMission(): ?string
    {
        return $this->campaign->missions[$this->step] ?? null;
    }
}
