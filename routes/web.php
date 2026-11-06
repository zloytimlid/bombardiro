<?php

use App\Http\Controllers\AboutController;
use App\Http\Controllers\Api\AccountApiController;
use App\Http\Controllers\Api\CampaignApiController;
use App\Http\Controllers\Api\CrewApiController;
use App\Http\Controllers\Api\FlightApiController;
use App\Http\Controllers\Api\GeneratedMissionController;
use App\Http\Controllers\Api\MissionCatalogController;
use App\Http\Controllers\Api\ReplayController;
use App\Http\Controllers\Api\SessionApiController;
use App\Http\Controllers\Api\TelemetryController;
use App\Http\Controllers\Auth\SocialAuthController;
use App\Http\Controllers\CrewPageController;
use App\Http\Controllers\DashboardController;
use App\Http\Controllers\Diagnostics\RealtimeCheckController;
use App\Http\Controllers\HangarController;
use App\Http\Controllers\MissionController;
use App\Http\Controllers\TrainingController;
use Illuminate\Support\Facades\Route;

Route::inertia('/', 'Welcome')->name('home');
Route::get('about', AboutController::class)->name('about');

// Вход через Discord и Google (этап 5).
Route::middleware('guest')->group(function () {
    Route::get('auth/{provider}/redirect', [SocialAuthController::class, 'redirect'])->whereIn('provider', ['discord', 'google'])->name('social.redirect');
    Route::get('auth/{provider}/callback', [SocialAuthController::class, 'callback'])->whereIn('provider', ['discord', 'google'])->name('social.callback');
});

Route::middleware(['auth', 'verified'])->group(function () {
    Route::get('dashboard', DashboardController::class)->name('dashboard');

    Route::get('training/{station}', [TrainingController::class, 'show'])->name('training.show');

    Route::get('hangar', [HangarController::class, 'show'])->name('hangar');
    Route::get('leaderboards', [HangarController::class, 'leaderboardPage'])->name('leaderboards');

    Route::get('missions', [MissionController::class, 'index'])->name('missions.index');
    Route::get('missions/{slug}/solo', [MissionController::class, 'solo'])->where('slug', '[a-z0-9-]+')->name('missions.solo');

    Route::middleware('throttle:api')->prefix('api')->name('api.')->group(function () {
        Route::get('missions', [MissionCatalogController::class, 'index'])->name('missions.index');
        Route::get('missions/{slug}', [MissionCatalogController::class, 'show'])->where('slug', '[a-z0-9-]+')->name('missions.show');
        Route::get('leaderboards', [HangarController::class, 'leaderboard'])->name('leaderboards');

        // Настройки и данные игрока (раздел 11, раздел 13: выгрузка своих данных).
        Route::get('me/settings', [AccountApiController::class, 'settings'])->name('me.settings.show');
        Route::put('me/settings', [AccountApiController::class, 'saveSettings'])->name('me.settings.update');
        Route::get('me/export', [AccountApiController::class, 'export'])->name('me.export');

        // Этап 6: повторы и кампании.
        Route::get('sessions/{session}/replay', [ReplayController::class, 'show'])->name('sessions.replay');
        Route::post('sessions/{session}/replay/pin', [ReplayController::class, 'pin'])->name('sessions.replay.pin');
        Route::get('campaigns', [CampaignApiController::class, 'index'])->name('campaigns.index');
        Route::post('crews/{crew}/campaign', [CampaignApiController::class, 'enroll'])->name('crews.campaign.enroll');
        Route::delete('crews/{crew}/campaign', [CampaignApiController::class, 'leave'])->name('crews.campaign.leave');
        Route::post('crews/{crew}/campaign/repair', [CampaignApiController::class, 'repair'])->name('crews.campaign.repair');
        Route::post('missions/generated', [GeneratedMissionController::class, 'store'])->name('missions.generated');
        Route::post('crews/{crew}/flight', [FlightApiController::class, 'store'])->name('crews.flight.store');
        Route::post('crews/{crew}/flight/join', [FlightApiController::class, 'join'])->name('crews.flight.join');
        Route::delete('crews/{crew}/flight', [FlightApiController::class, 'leave'])->name('crews.flight.leave');
        Route::get('flights/{flight}', [FlightApiController::class, 'show'])->name('flights.show');
        Route::post('flights/{flight}/start', [FlightApiController::class, 'start'])->name('flights.start');

        // Лобби экипажа (раздел 11).
        Route::post('crews', [CrewApiController::class, 'store'])->name('crews.store');
        Route::post('crews/join', [CrewApiController::class, 'join'])->name('crews.join');
        Route::post('crews/{crew}/seats/{seat}', [CrewApiController::class, 'claimSeat'])->name('crews.seats.claim');
        Route::delete('crews/{crew}/seats/{seat}', [CrewApiController::class, 'releaseSeat'])->name('crews.seats.release');
        Route::post('crews/{crew}/ready', [CrewApiController::class, 'ready'])->name('crews.ready');
        Route::patch('crews/{crew}', [CrewApiController::class, 'configure'])->name('crews.configure');
        Route::delete('crews/{crew}/members/me', [CrewApiController::class, 'leave'])->name('crews.leave');
        Route::post('crews/{crew}/start', [CrewApiController::class, 'start'])->name('crews.start');

        // Вылет (раздел 11).
        Route::get('sessions/{session}/bootstrap', [SessionApiController::class, 'bootstrap'])->name('sessions.bootstrap');
        Route::get('sessions/{session}/snapshot', [SessionApiController::class, 'getSnapshot'])->name('sessions.snapshot.show');
        Route::post('sessions/{session}/host-lost', [SessionApiController::class, 'hostLost'])->name('sessions.host-lost');
        Route::post('sessions/{session}/finish', [SessionApiController::class, 'finish'])->name('sessions.finish');
        Route::get('sessions/{session}/debrief', [SessionApiController::class, 'debrief'])->name('sessions.debrief');
    });

    Route::prefix('api')->name('api.')->group(function () {
        Route::post('crews/{crew}/heartbeat', [CrewApiController::class, 'heartbeat'])->middleware('throttle:session-heartbeat')->name('crews.heartbeat');
        Route::post('sessions/{session}/rtt', [SessionApiController::class, 'heartbeat'])->middleware('throttle:session-heartbeat')->name('sessions.rtt');
        Route::post('sessions/{session}/events', [SessionApiController::class, 'events'])->middleware('throttle:session-events')->name('sessions.events');
        Route::put('sessions/{session}/snapshot', [SessionApiController::class, 'putSnapshot'])->middleware('throttle:session-snapshot')->name('sessions.snapshot.store');
        Route::post('telemetry', TelemetryController::class)->middleware('throttle:telemetry')->name('telemetry');
    });

    Route::get('crews/{crew}', [CrewPageController::class, 'lobby'])->name('crews.show');
    Route::get('play/{session}', [CrewPageController::class, 'play'])->name('play');
    Route::get('debrief/{session}', [CrewPageController::class, 'debrief'])->name('debrief');

    Route::get('diagnostics/realtime', [RealtimeCheckController::class, 'show'])
        ->name('diagnostics.realtime');
    Route::post('api/diagnostics/radio-check', [RealtimeCheckController::class, 'broadcast'])
        ->middleware('throttle:api')
        ->name('diagnostics.radio-check');
});

require __DIR__.'/settings.php';
