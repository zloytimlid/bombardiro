<?php

declare(strict_types=1);

namespace App\Domain\FlightSessions\Models;

use App\Domain\Aircraft\Enums\Station;
use App\Models\User;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * Участник вылета: одна строка на каждый период занятия места; ИИ — user_id = null (раздел 10).
 *
 * @property int $id
 * @property int $flight_session_id
 * @property int|null $user_id
 * @property Station $seat
 * @property bool $is_ai
 * @property Carbon $joined_at
 * @property Carbon|null $left_at
 * @property array<string, mixed>|null $metrics
 * @property-read FlightSession $session
 * @property-read User|null $user
 */
#[Fillable(['flight_session_id', 'user_id', 'seat', 'is_ai', 'joined_at', 'left_at', 'metrics'])]
class FlightSessionParticipant extends Model
{
    public $timestamps = false;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'seat' => Station::class,
            'is_ai' => 'boolean',
            'joined_at' => 'datetime',
            'left_at' => 'datetime',
            'metrics' => 'array',
        ];
    }

    /**
     * @return BelongsTo<FlightSession, $this>
     */
    public function session(): BelongsTo
    {
        return $this->belongsTo(FlightSession::class, 'flight_session_id');
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
