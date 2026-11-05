<?php

use App\Http\Controllers\Api\MissionCatalogController;
use App\Http\Controllers\DashboardController;
use App\Http\Controllers\Diagnostics\RealtimeCheckController;
use App\Http\Controllers\MissionController;
use App\Http\Controllers\TrainingController;
use Illuminate\Support\Facades\Route;

Route::inertia('/', 'Welcome')->name('home');

Route::middleware(['auth', 'verified'])->group(function () {
    Route::get('dashboard', DashboardController::class)->name('dashboard');

    Route::get('training/{station}', [TrainingController::class, 'show'])->name('training.show');

    Route::get('missions', [MissionController::class, 'index'])->name('missions.index');
    Route::get('missions/{slug}/solo', [MissionController::class, 'solo'])->where('slug', '[a-z0-9-]+')->name('missions.solo');

    Route::middleware('throttle:api')->prefix('api')->name('api.')->group(function () {
        Route::get('missions', [MissionCatalogController::class, 'index'])->name('missions.index');
        Route::get('missions/{slug}', [MissionCatalogController::class, 'show'])->where('slug', '[a-z0-9-]+')->name('missions.show');
    });

    Route::get('diagnostics/realtime', [RealtimeCheckController::class, 'show'])
        ->name('diagnostics.realtime');
    Route::post('api/diagnostics/radio-check', [RealtimeCheckController::class, 'broadcast'])
        ->middleware('throttle:api')
        ->name('diagnostics.radio-check');
});

require __DIR__.'/settings.php';
