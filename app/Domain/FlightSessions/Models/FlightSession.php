<?php

declare(strict_types=1);

namespace App\Domain\FlightSessions\Models;

use App\Domain\Crews\Models\Crew;
use App\Domain\FlightSessions\Enums\FlightSessionStatus;
use App\Domain\Missions\Models\Mission;
use App\Models\User;
use Database\Factories\FlightSessionFactory;
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
 * Вылет экипажа (раздел 10). Называется flight_sessions, чтобы не конфликтовать с sessions Laravel.
 *
 * @property int $id
 * @property string $ulid
 * @property int $crew_id
 * @property int $mission_id
 * @property int $mission_version
 * @property int $seed
 * @property string $difficulty
 * @property FlightSessionStatus $status
 * @property int|null $host_user_id
 * @property Carbon|null $started_at
 * @property Carbon|null $ended_at
 * @property string|null $outcome
 * @property int|null $score
 * @property bool $verified
 * @property list<string> $flags
 * @property array<string, mixed>|null $debrief
 * @property int $last_seq
 * @property Carbon|null $awarded_at
 * @property Carbon|null $reviewed_at
 * @property int|null $campaign_progress_id
 * @property int|null $flight_id
 * @property int|null $flight_slot
 * @property int|null $reviewed_by
 * @property string|null $review_decision
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property-read Crew $crew
 * @property-read Mission $mission
 * @property-read User|null $host
 * @property-read Collection<int, FlightSessionParticipant> $participants
 */
#[Fillable(['crew_id', 'mission_id', 'mission_version', 'seed', 'difficulty', 'status', 'host_user_id', 'started_at', 'ended_at', 'outcome', 'score', 'verified', 'flags', 'debrief', 'last_seq', 'campaign_progress_id', 'flight_id', 'flight_slot'])]
#[UseFactory(FlightSessionFactory::class)]
class FlightSession extends Model
{
    /** @use HasFactory<FlightSessionFactory> */
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
            'status' => FlightSessionStatus::class,
            'seed' => 'integer',
            'mission_version' => 'integer',
            'started_at' => 'datetime',
            'ended_at' => 'datetime',
            'score' => 'integer',
            'verified' => 'boolean',
            'flags' => 'array',
            'debrief' => 'array',
            'last_seq' => 'integer',
            'awarded_at' => 'datetime',
            'reviewed_at' => 'datetime',
        ];
    }

    /**
     * @return BelongsTo<Crew, $this>
     */
    public function crew(): BelongsTo
    {
        return $this->belongsTo(Crew::class);
    }

    /**
     * @return BelongsTo<Mission, $this>
     */
    public function mission(): BelongsTo
    {
        return $this->belongsTo(Mission::class);
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function host(): BelongsTo
    {
        return $this->belongsTo(User::class, 'host_user_id');
    }

    /**
     * @return HasMany<FlightSessionParticipant, $this>
     */
    public function participants(): HasMany
    {
        return $this->hasMany(FlightSessionParticipant::class);
    }

    /**
     * @return HasMany<FlightSessionEvent, $this>
     */
    public function events(): HasMany
    {
        return $this->hasMany(FlightSessionEvent::class);
    }

    public function isParticipant(User $user): bool
    {
        return $this->participants()->where('user_id', $user->id)->exists();
    }

    public function isHost(User $user): bool
    {
        return $this->host_user_id === $user->id;
    }
}
