<?php

declare(strict_types=1);

use App\Domain\Aircraft\Actions\SyncSimContent;
use App\Domain\Crews\Enums\CrewStatus;
use App\Domain\Crews\Jobs\CloseStaleCrews;
use App\Domain\Crews\Models\Crew;
use App\Domain\FlightSessions\Enums\FlightSessionStatus;
use App\Domain\FlightSessions\Jobs\PurgeOldEvents;
use App\Domain\FlightSessions\Models\FlightSession;
use App\Domain\FlightSessions\Models\FlightSessionParticipant;
use App\Domain\Missions\Models\Mission;
use App\Models\User;
use Illuminate\Foundation\Http\Middleware\PreventRequestForgery;
use Illuminate\Routing\Router;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Hash;

/**
 * Этап 5: чек-лист безопасности раздела 13 и персональные данные.
 */
beforeEach(function (): void {
    app(SyncSimContent::class)->handle();
    Event::fake();
});

it('hashes passwords with argon2id', function (): void {
    // Тесты для скорости хэшируют bcrypt (phpunit.xml); продакшен и разработка — argon2id из окружения.
    expect(file_get_contents(base_path('.env.example')))->toContain('HASH_DRIVER=argon2id');

    config(['hashing.driver' => 'argon2id']);
    Hash::forgetDrivers();

    expect(Hash::info(Hash::make('correct horse battery'))['algoName'])->toBe('argon2id');
});

it('sends a strict CSP with a nonce and security headers', function (): void {
    $response = $this->get('/')->assertOk();
    $csp = (string) $response->headers->get('Content-Security-Policy');

    expect($csp)->toContain("default-src 'self'")
        ->toContain("frame-ancestors 'none'")
        ->toContain("object-src 'none'")
        ->toMatch("/script-src 'self' 'nonce-[A-Za-z0-9+\\/=]+'/")
        ->and($response->headers->get('X-Content-Type-Options'))->toBe('nosniff')
        ->and($response->headers->get('X-Frame-Options'))->toBe('DENY')
        ->and($response->headers->get('Referrer-Policy'))->toBe('strict-origin-when-cross-origin');

    preg_match("/'nonce-([^']+)'/", $csp, $m);

    // Встроенный скрипт темы помечен тем же nonce.
    expect($response->getContent())->toContain('nonce="'.$m[1].'"');
});

it('keeps the XSRF check in the web group that serves the API', function (): void {
    // В тестах Laravel проверку токена отключает сам; проверяем, что она стоит в группе маршрутов.
    $web = app(Router::class)->getMiddlewareGroups()['web'] ?? [];

    expect($web)->toContain(PreventRequestForgery::class);
});

it('logs a banned player out and blocks the API', function (): void {
    $user = User::factory()->withPilotProfile()->create(['banned_at' => now(), 'ban_reason' => 'cheating']);

    $this->actingAs($user)->getJson('/api/me/settings')->assertForbidden()->assertJsonPath('message', __('account.banned'));
    $this->assertGuest();
});

it('stores validated settings with defaults and exports the player data', function (): void {
    $user = User::factory()->withPilotProfile('Exporter')->create();

    $this->actingAs($user)->getJson('/api/me/settings')->assertOk()
        ->assertJsonPath('data.graphics', 'medium')
        ->assertJsonPath('data.ui_scale', 100);

    $this->actingAs($user)->putJson('/api/me/settings', ['ui_scale' => 130, 'bindings' => ['pitch_up' => ['KeyS', 'gp:axis1-']], 'camera_shake' => false])->assertOk()
        ->assertJsonPath('data.ui_scale', 130)
        ->assertJsonPath('data.graphics', 'medium');
    $this->actingAs($user)->putJson('/api/me/settings', ['ui_scale' => 300])->assertUnprocessable();

    expect($user->refresh()->settings['camera_shake'])->toBeFalse();

    $this->actingAs($user)->getJson('/api/me/export')->assertOk()
        ->assertHeader('Content-Disposition', 'attachment; filename="lil-critter-my-data.json"')
        ->assertJsonPath('account.email', $user->email)
        ->assertJsonPath('profile.callsign', 'Exporter')
        ->assertJsonPath('settings.ui_scale', 130);
});

it('deletes the account but keeps the crew sortie, anonymised, for the others', function (): void {
    $owner = User::factory()->withPilotProfile()->create();
    $mate = User::factory()->withPilotProfile()->create();
    $crew = Crew::factory()->create(['owner_id' => $owner->id, 'mission_id' => Mission::latestPublished('milk-run')?->id, 'status' => CrewStatus::Closed]);
    $session = FlightSession::factory()->create(['crew_id' => $crew->id, 'mission_id' => $crew->mission_id, 'host_user_id' => $owner->id, 'status' => FlightSessionStatus::Finished]);

    foreach (['pilot' => $owner, 'tail_gunner' => $mate] as $seat => $u) {
        $session->participants()->create(['user_id' => $u->id, 'seat' => $seat, 'is_ai' => false, 'joined_at' => now()]);
    }

    $this->actingAs($owner)->delete(route('profile.destroy'), ['password' => 'password'])->assertRedirect('/');

    expect(User::query()->find($owner->id))->toBeNull()
        ->and(FlightSession::query()->find($session->id))->not->toBeNull()
        ->and($crew->refresh()->owner_id)->toBeNull()
        ->and(FlightSessionParticipant::query()->where('flight_session_id', $session->id)->whereNull('user_id')->whereNotNull('anonymized_at')->count())->toBe(1)
        ->and(FlightSessionParticipant::query()->where('user_id', $mate->id)->count())->toBe(1);
});

it('purges old journal events and closes stale lobbies and sessions', function (): void {
    $owner = User::factory()->withPilotProfile()->create();
    $crew = Crew::factory()->create(['owner_id' => $owner->id, 'mission_id' => Mission::latestPublished('milk-run')?->id, 'status' => CrewStatus::Lobby]);
    $crew->members()->create(['user_id' => $owner->id, 'seat' => 'pilot', 'is_ready' => false, 'last_seen_at' => now()->subHours(3), 'joined_at' => now()->subHours(3)]);
    Crew::query()->whereKey($crew->id)->update(['updated_at' => now()->subHours(3)]);

    $session = FlightSession::factory()->create(['crew_id' => $crew->id, 'mission_id' => $crew->mission_id, 'host_user_id' => $owner->id]);
    FlightSession::query()->whereKey($session->id)->update(['updated_at' => now()->subHour()]);
    $session->events()->create(['seq' => 1, 'tick' => 1, 'type' => 'phase', 'payload' => [], 'created_at' => now()->subDays(91)]);
    $session->events()->create(['seq' => 2, 'tick' => 2, 'type' => 'phase', 'payload' => [], 'created_at' => now()->subDays(5)]);

    (new PurgeOldEvents)->handle();
    (new CloseStaleCrews)->handle();

    expect($session->events()->pluck('seq')->all())->toBe([2])
        ->and($session->refresh()->status)->toBe(FlightSessionStatus::Aborted)
        ->and($crew->refresh()->status)->not->toBe(CrewStatus::InSession);
});
