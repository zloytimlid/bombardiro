<?php

declare(strict_types=1);

namespace App\Domain\Progression\Models;

use App\Domain\Aircraft\Enums\Station;
use App\Models\User;
use Database\Factories\PilotProfileFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\UseFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * @property int $id
 * @property int $user_id
 * @property string $callsign
 * @property string $rank
 * @property int $missions_total
 * @property int $flight_seconds_total
 * @property Station|null $preferred_seat
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property-read User $user
 */
#[Fillable(['user_id', 'callsign', 'rank', 'preferred_seat'])]
#[UseFactory(PilotProfileFactory::class)]
class PilotProfile extends Model
{
    /** @use HasFactory<PilotProfileFactory> */
    use HasFactory;

    /** @var array<string, mixed> */
    protected $attributes = [
        'rank' => 'second_lieutenant',
        'missions_total' => 0,
        'flight_seconds_total' => 0,
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'missions_total' => 'integer',
            'flight_seconds_total' => 'integer',
            'preferred_seat' => Station::class,
        ];
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
