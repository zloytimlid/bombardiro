<?php

use App\Domain\Progression\Models\PilotProfile;
use App\Enums\UserRole;
use App\Models\User;

it('creates a pilot profile with the callsign on registration', function (): void {
    $response = $this->post(route('register.store'), [
        'name' => 'Joseph',
        'email' => 'joseph@example.com',
        'callsign' => 'Yossarian',
        'password' => 'Str0ng-pass-phrase!',
        'password_confirmation' => 'Str0ng-pass-phrase!',
    ]);

    $response->assertSessionHasNoErrors();
    $this->assertAuthenticated();

    $user = User::query()->where('email', 'joseph@example.com')->firstOrFail();

    expect($user->role)->toBe(UserRole::Player)
        ->and($user->pilotProfile)->not->toBeNull()
        ->and($user->pilotProfile?->callsign)->toBe('Yossarian')
        ->and($user->pilotProfile?->missions_total)->toBe(0);
});

it('rejects a callsign that is taken in any letter case', function (): void {
    PilotProfile::factory()->create(['callsign' => 'Yossarian']);

    $this->post(route('register.store'), [
        'name' => 'Clone',
        'email' => 'clone@example.com',
        'callsign' => 'YOSSARIAN',
        'password' => 'Str0ng-pass-phrase!',
        'password_confirmation' => 'Str0ng-pass-phrase!',
    ])->assertSessionHasErrors('callsign');

    $this->assertGuest();
    expect(User::query()->where('email', 'clone@example.com')->exists())->toBeFalse();
});

it('rejects malformed callsigns', function (string $callsign): void {
    $this->post(route('register.store'), [
        'name' => 'Bad',
        'email' => 'bad@example.com',
        'callsign' => $callsign,
        'password' => 'Str0ng-pass-phrase!',
        'password_confirmation' => 'Str0ng-pass-phrase!',
    ])->assertSessionHasErrors('callsign');
})->with(['', 'ab', 'with space', 'кириллица', str_repeat('x', 25)]);

it('does not let a user assign themselves a role through registration', function (): void {
    $this->post(route('register.store'), [
        'name' => 'Sneaky',
        'email' => 'sneaky@example.com',
        'callsign' => 'Sneaky',
        'role' => 'admin',
        'password' => 'Str0ng-pass-phrase!',
        'password_confirmation' => 'Str0ng-pass-phrase!',
    ]);

    expect(User::query()->where('email', 'sneaky@example.com')->firstOrFail()->role)->toBe(UserRole::Player);
});
