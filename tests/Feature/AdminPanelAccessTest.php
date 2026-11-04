<?php

use App\Models\User;

it('redirects guests from /admin to the login page', function (): void {
    $this->get('/admin')->assertRedirect(route('login'));
});

it('forbids /admin for players and moderators', function (string $state): void {
    $user = User::factory()->{$state}()->withTwoFactor()->create();

    $this->actingAs($user)->get('/admin')->assertForbidden();
})->with(['unverified', 'moderator']);

it('forbids /admin for an admin without confirmed 2FA', function (): void {
    $admin = User::factory()->admin()->create();

    $this->actingAs($admin)->get('/admin')->assertForbidden();
});

it('allows /admin for an admin with confirmed 2FA', function (): void {
    $admin = User::factory()->admin()->withTwoFactor()->create();

    $this->actingAs($admin)->get('/admin')->assertOk();
});

it('allows an admin without 2FA only when the requirement is switched off', function (): void {
    config(['admin.require_2fa' => false]);
    $admin = User::factory()->admin()->create();

    $this->actingAs($admin)->get('/admin')->assertOk();
});
