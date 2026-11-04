<?php

use App\Domain\Aircraft\Actions\SyncSimContent;
use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Artisan::command('sim:sync', function (SyncSimContent $sync) {
    $sync->handle();
    $this->info('Театры, типы самолётов и борта загружены из resources/sim.');
})->purpose('Load theatre and aircraft content from resources/sim into the database');
