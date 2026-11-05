<?php

use App\Domain\Aircraft\Actions\SyncSimContent;
use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Artisan::command('sim:sync', function (SyncSimContent $sync) {
    $sync->handle();
    $this->info('Театры, типы самолётов, борта и миссии загружены из resources/sim.');
})->purpose('Load theatres, aircraft and missions from resources/sim into the database');
