<?php

use App\Http\Controllers\DashboardController;
use App\Http\Controllers\Diagnostics\RealtimeCheckController;
use Illuminate\Support\Facades\Route;

Route::inertia('/', 'Welcome')->name('home');

Route::middleware(['auth', 'verified'])->group(function () {
    Route::get('dashboard', DashboardController::class)->name('dashboard');

    Route::get('diagnostics/realtime', [RealtimeCheckController::class, 'show'])
        ->name('diagnostics.realtime');
    Route::post('api/diagnostics/radio-check', [RealtimeCheckController::class, 'broadcast'])
        ->middleware('throttle:api')
        ->name('diagnostics.radio-check');
});

require __DIR__.'/settings.php';
