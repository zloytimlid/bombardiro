<?php

declare(strict_types=1);

namespace App\Domain\FlightSessions\Jobs;

use App\Domain\FlightSessions\Models\FlightSessionReplay;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;

/**
 * Раздел 10: повторы хранятся 30 дней, закреплённые — без срока. Ежедневно.
 */
final class PurgeOldReplays implements ShouldQueue
{
    use Queueable;

    public function handle(): void
    {
        $deleted = 0;

        FlightSessionReplay::query()
            ->where('pinned', false)
            ->where('created_at', '<', now()->subDays(FlightSessionReplay::RETENTION_DAYS))
            ->chunkById(200, function ($replays) use (&$deleted): void {
                foreach ($replays as $replay) {
                    Storage::delete($replay->storage_path);
                    $replay->delete();
                    $deleted++;
                }
            });

        Log::info('flight_replays_purged', ['deleted' => $deleted]);
    }
}
