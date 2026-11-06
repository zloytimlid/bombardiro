<?php

declare(strict_types=1);

namespace App\Domain\FlightSessions\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * Событие журнала вылета (раздел 9.3): уникально по (сессия, seq), приём идемпотентный.
 *
 * @property int $id
 * @property int $flight_session_id
 * @property int $seq
 * @property int $tick
 * @property string $type
 * @property array<string, mixed> $payload
 * @property Carbon $created_at
 */
#[Fillable(['flight_session_id', 'seq', 'tick', 'type', 'payload', 'created_at'])]
class FlightSessionEvent extends Model
{
    public $timestamps = false;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'seq' => 'integer',
            'tick' => 'integer',
            'payload' => 'array',
            'created_at' => 'datetime',
        ];
    }

    /**
     * @return BelongsTo<FlightSession, $this>
     */
    public function session(): BelongsTo
    {
        return $this->belongsTo(FlightSession::class, 'flight_session_id');
    }
}
