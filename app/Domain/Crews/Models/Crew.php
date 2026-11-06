<?php

declare(strict_types=1);

namespace App\Domain\Crews\Models;

use App\Domain\Crews\Enums\CrewStatus;
use App\Domain\Crews\Enums\CrewVisibility;
use App\Domain\FlightSessions\Models\FlightSession;
use App\Domain\Missions\Models\Mission;
use App\Models\User;
use Database\Factories\CrewFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\UseFactory;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * Экипаж (раздел 10): лобби с 8 местами, код приглашения, выбранная миссия.
 * Публичный идентификатор — ULID, внутренний — bigint.
 *
 * @property int $id
 * @property string $ulid
 * @property string $name
 * @property int|null $owner_id
 * @property string $invite_code
 * @property CrewVisibility $visibility
 * @property int $max_players
 * @property CrewStatus $status
 * @property int $mission_id
 * @property string $difficulty
 * @property int|null $host_user_id
 * @property int|null $campaign_progress_id
 * @property int|null $flight_id
 * @property int|null $flight_slot
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property-read User $owner
 * @property-read Mission $mission
 * @property-read Collection<int, CrewMember> $members
 */
#[Fillable(['name', 'owner_id', 'invite_code', 'visibility', 'max_players', 'status', 'mission_id', 'difficulty', 'host_user_id', 'campaign_progress_id', 'flight_id', 'flight_slot'])]
#[UseFactory(CrewFactory::class)]
class Crew extends Model
{
    /** @use HasFactory<CrewFactory> */
    use HasFactory, HasUlids;

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
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'visibility' => CrewVisibility::class,
            'status' => CrewStatus::class,
            'max_players' => 'integer',
        ];
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function owner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'owner_id');
    }

    /**
     * @return BelongsTo<Mission, $this>
     */
    public function mission(): BelongsTo
    {
        return $this->belongsTo(Mission::class);
    }

    /**
     * @return HasMany<CrewMember, $this>
     */
    public function members(): HasMany
    {
        return $this->hasMany(CrewMember::class);
    }

    /**
     * @return HasMany<FlightSession, $this>
     */
    public function sessions(): HasMany
    {
        return $this->hasMany(FlightSession::class);
    }

    public function memberFor(User $user): ?CrewMember
    {
        return $this->members()->where('user_id', $user->id)->first();
    }

    public function hasMember(User $user): bool
    {
        return $this->members()->where('user_id', $user->id)->exists();
    }
}
