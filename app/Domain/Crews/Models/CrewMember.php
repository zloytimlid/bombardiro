<?php

declare(strict_types=1);

namespace App\Domain\Crews\Models;

use App\Domain\Aircraft\Enums\Station;
use App\Models\User;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * Член экипажа: место (одна из 8 станций или null), готовность, RTT для выбора хоста.
 *
 * @property int $id
 * @property int $crew_id
 * @property int $user_id
 * @property Station|null $seat
 * @property bool $is_ready
 * @property int|null $rtt_ms
 * @property Carbon|null $last_seen_at
 * @property Carbon $joined_at
 * @property-read Crew $crew
 * @property-read User $user
 */
#[Fillable(['crew_id', 'user_id', 'seat', 'is_ready', 'rtt_ms', 'last_seen_at', 'joined_at'])]
class CrewMember extends Model
{
    /** Место держится за отключившимся игроком 120 с (раздел 9.3). */
    public const int SEAT_HOLD_SECONDS = 120;

    public $timestamps = false;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'seat' => Station::class,
            'is_ready' => 'boolean',
            'rtt_ms' => 'integer',
            'last_seen_at' => 'datetime',
            'joined_at' => 'datetime',
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
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** Игрок на связи: отметка не старше указанного окна. */
    public function seenWithin(int $seconds): bool
    {
        return $this->last_seen_at !== null && $this->last_seen_at->gt(now()->subSeconds($seconds));
    }
}
