<?php

declare(strict_types=1);

namespace App\Domain\Progression\Models;

use App\Domain\FlightSessions\Models\FlightSession;
use App\Models\User;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * @property int $id
 * @property int $user_id
 * @property int $achievement_id
 * @property int|null $flight_session_id
 * @property Carbon $unlocked_at
 * @property-read Achievement $achievement
 * @property-read User $user
 * @property-read FlightSession|null $session
 */
#[Fillable(['user_id', 'achievement_id', 'flight_session_id', 'unlocked_at'])]
class UserAchievement extends Model
{
    public $timestamps = false;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['unlocked_at' => 'datetime'];
    }

    /**
     * @return BelongsTo<Achievement, $this>
     */
    public function achievement(): BelongsTo
    {
        return $this->belongsTo(Achievement::class);
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * @return BelongsTo<FlightSession, $this>
     */
    public function session(): BelongsTo
    {
        return $this->belongsTo(FlightSession::class, 'flight_session_id');
    }
}
