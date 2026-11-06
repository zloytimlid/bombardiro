<?php

declare(strict_types=1);

namespace App\Domain\Flights\Models;

use App\Domain\Crews\Models\Crew;
use App\Domain\Missions\Models\Mission;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Звено (этап 6): до 4 экипажей на одной миссии.
 *
 * @property int $id
 * @property string $ulid
 * @property string $invite_code
 * @property int $leader_crew_id
 * @property int $mission_id
 * @property string $status
 * @property int|null $seed
 * @property-read Crew $leader
 * @property-read Mission $mission
 * @property-read Collection<int, Crew> $crews
 */
#[Fillable(['invite_code', 'leader_crew_id', 'mission_id', 'status', 'seed'])]
class Flight extends Model
{
    use HasUlids;

    public const int MAX_CREWS = 4;

    /**
     * @return list<string>
     */
    public function uniqueIds(): array
    {
        return ['ulid'];
    }

    public function getRouteKeyName(): string
    {
        return 'ulid';
    }

    /**
     * @return BelongsTo<Crew, $this>
     */
    public function leader(): BelongsTo
    {
        return $this->belongsTo(Crew::class, 'leader_crew_id');
    }

    /**
     * @return BelongsTo<Mission, $this>
     */
    public function mission(): BelongsTo
    {
        return $this->belongsTo(Mission::class);
    }

    /**
     * @return HasMany<Crew, $this>
     */
    public function crews(): HasMany
    {
        return $this->hasMany(Crew::class)->orderBy('flight_slot');
    }
}
