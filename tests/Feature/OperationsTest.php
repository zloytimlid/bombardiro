<?php

declare(strict_types=1);

use App\Domain\Accounts\Models\SocialAccount;
use App\Enums\UserRole;
use App\Models\User;
use Laravel\Socialite\Contracts\Provider;
use Laravel\Socialite\Facades\Socialite;
use Laravel\Socialite\Two\User as SocialiteUser;

/**
 * Этап 5: вход через Discord/Google, телеметрия клиента, доступ к Pulse.
 */
function fakeProvider(string $id, ?string $email, string $nickname): void
{
    $external = (new SocialiteUser)->map(['id' => $id, 'nickname' => $nickname, 'name' => $nickname, 'email' => $email]);
    $provider = Mockery::mock(Provider::class);
    $provider->shouldReceive('user')->andReturn($external);
    Socialite::shouldReceive('driver')->with('discord')->andReturn($provider);
}

beforeEach(function (): void {
    config(['services.discord.client_id' => 'id', 'services.discord.client_secret' => 'secret']);
});

it('hides providers without keys and 404s their routes', function (): void {
    config(['services.google.client_id' => null]);

    $this->get('/auth/google/redirect')->assertNotFound();
    $this->get(route('login'))->assertInertia(fn ($page) => $page->where('socialProviders', ['discord']));
});

it('signs up a new player through Discord with a unique callsign', function (): void {
    User::factory()->withPilotProfile('Maverick')->create();
    fakeProvider('d-42', 'maverick@example.com', 'Maverick');

    $this->get('/auth/discord/callback')->assertRedirect(route('dashboard'));

    $user = User::query()->where('email', 'maverick@example.com')->firstOrFail();

    $this->assertAuthenticatedAs($user);
    expect($user->email_verified_at)->not->toBeNull()
        ->and($user->pilotProfile->callsign)->toBe('Maverick2')
        ->and(SocialAccount::query()->where('provider', 'discord')->where('provider_id', 'd-42')->value('user_id'))->toBe($user->id);
});

it('links Discord to an existing account by e-mail and reuses the link next time', function (): void {
    $user = User::factory()->withPilotProfile('Goose')->create(['email' => 'goose@example.com']);

    fakeProvider('d-7', 'goose@example.com', 'goose');
    $this->get('/auth/discord/callback')->assertRedirect(route('dashboard'));
    auth()->logout();

    fakeProvider('d-7', 'changed@example.com', 'goose');
    $this->get('/auth/discord/callback')->assertRedirect(route('dashboard'));

    $this->assertAuthenticatedAs($user);
    expect(SocialAccount::query()->count())->toBe(1);
});

it('refuses a banned player at the OAuth callback', function (): void {
    $user = User::factory()->withPilotProfile('Iceman')->create(['email' => 'ice@example.com', 'banned_at' => now()]);

    SocialAccount::query()->create(['user_id' => $user->id, 'provider' => 'discord', 'provider_id' => 'd-9']);
    fakeProvider('d-9', 'ice@example.com', 'Iceman');

    $this->get('/auth/discord/callback')->assertRedirect(route('login'));
    $this->assertGuest();
});

it('accepts aggregated client telemetry and rate-limits it', function (): void {
    $user = User::factory()->withPilotProfile()->create();

    $this->actingAs($user)->postJson('/api/telemetry', ['fps' => 58.4, 'preset' => 'medium', 'rtt_ms' => 85, 'mode' => 'crew'])->assertAccepted();
    $this->actingAs($user)->postJson('/api/telemetry', ['fps' => 900, 'preset' => 'medium', 'mode' => 'crew'])->assertUnprocessable();

    for ($i = 0; $i < 5; $i++) {
        $this->actingAs($user)->postJson('/api/telemetry', ['fps' => 60, 'preset' => 'low', 'mode' => 'solo']);
    }

    $this->actingAs($user)->postJson('/api/telemetry', ['fps' => 60, 'preset' => 'low', 'mode' => 'solo'])->assertTooManyRequests();
});

it('opens Pulse to admins only', function (): void {
    $player = User::factory()->create();
    $admin = User::factory()->create();

    $admin->forceFill(['role' => UserRole::Admin])->save();

    $this->actingAs($player)->get('/pulse')->assertForbidden();
    $this->actingAs($admin)->get('/pulse')->assertOk();
});
