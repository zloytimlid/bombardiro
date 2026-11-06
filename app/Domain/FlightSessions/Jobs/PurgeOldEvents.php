<?php

declare(strict_types=1);

namespace App\Domain\FlightSessions\Jobs;

use App\Domain\FlightSessions\Models\FlightSessionEvent;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;

/**
 * Раздел 10: журнал вылетов хранится 90 дней (разбор и рейтинги — в flight_sessions, они остаются).
 * Ежедневно, пачками — без длинной блокировки таблицы.
 */
final class PurgeOldEvents implements ShouldQueue
{
    use Queueable;

    public const int RETENTION_DAYS = 90;

    public function handle(): void
    {
        $cutoff = now()->subDays(self::RETENTION_DAYS);
        $total = 0;

        do {
            $ids = FlightSessionEvent::query()->where('created_at', '<', $cutoff)->orderBy('id')->limit(5000)->pluck('id');
            $total += FlightSessionEvent::query()->whereIn('id', $ids)->delete();
        } while ($ids->count() === 5000);

        Log::info('flight_events_purged', ['deleted' => $total, 'before' => $cutoff->toIso8601String()]);
    }
}
