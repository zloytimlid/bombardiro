<?php

declare(strict_types=1);

namespace App\Domain\FlightSessions\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * Повтор вылета (раздел 10): gzip-JSON в S3 — миссия, сид, журнал событий, трек.
 *
 * @property int $id
 * @property int $flight_session_id
 * @property string $storage_path
 * @property int $bytes
 * @property int $format_version
 * @property bool $pinned
 * @property Carbon|null $created_at
 * @property-read FlightSession $session
 */
#[Fillable(['flight_session_id', 'storage_path', 'bytes', 'format_version', 'pinned'])]
class FlightSessionReplay extends Model
{
    public const int FORMAT_VERSION = 1;

    public const int RETENTION_DAYS = 30;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['pinned' => 'boolean', 'bytes' => 'integer', 'format_version' => 'integer'];
    }

    /**
     * @return BelongsTo<FlightSession, $this>
     */
    public function session(): BelongsTo
    {
        return $this->belongsTo(FlightSession::class, 'flight_session_id');
    }
}
