<?php

use App\Domain\Aircraft\Actions\SyncSimContent;
use App\Domain\Crews\Jobs\CloseStaleCrews;
use App\Domain\FlightSessions\Jobs\PurgeOldEvents;
use App\Domain\FlightSessions\Jobs\PurgeOldReplays;
use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Artisan::command('sim:sync', function (SyncSimContent $sync) {
    $sync->handle();
    $this->info('Театры, типы самолётов, борта и миссии загружены из resources/sim.');
})->purpose('Load theatres, aircraft and missions from resources/sim into the database');

// Планировщик (раздел 11): журнал вылетов — 90 дней; брошенные лобби и вылеты — каждые 15 минут.
Schedule::job(new PurgeOldEvents)->dailyAt('04:10')->onOneServer()->withoutOverlapping();
Schedule::job(new CloseStaleCrews)->everyFifteenMinutes()->onOneServer()->withoutOverlapping();
// Повторы (раздел 10): 30 дней, закреплённые — без срока.
Schedule::job(new PurgeOldReplays)->dailyAt('04:30')->onOneServer()->withoutOverlapping();
