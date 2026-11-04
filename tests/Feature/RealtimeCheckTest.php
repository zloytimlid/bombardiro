<?php

use App\Events\Diagnostics\RadioCheck;
use App\Models\User;
use Illuminate\Support\Facades\Broadcast;
use Illuminate\Support\Facades\Event;

it('shows the realtime check page to verified users', function (): void {
    $user = User::factory()->withPilotProfile('Tester')->create();

    $this->actingAs($user)->get(route('diagnostics.realtime'))->assertOk();
});

it('broadcasts a radio check with the sender callsign', function (): void {
    Event::fake([RadioCheck::class]);
    $user = User::factory()->withPilotProfile('Tester')->create();

    $this->actingAs($user)
        ->postJson(route('diagnostics.radio-check'), ['message' => 'broadcast-ok'])
        ->assertAccepted();

    Event::assertDispatched(RadioCheck::class, fn (RadioCheck $event): bool => $event->callsign === 'Tester'
        && $event->message === 'broadcast-ok'
        && $event->broadcastOn()->name === 'presence-diagnostics'
        && $event->broadcastAs() === 'radio-check');
});

it('validates the radio check message', function (): void {
    $user = User::factory()->withPilotProfile()->create();

    $this->actingAs($user)
        ->postJson(route('diagnostics.radio-check'), ['message' => str_repeat('x', 121)])
        ->assertUnprocessable()
        ->assertJsonValidationErrors('message');
});

it('rejects radio checks from guests', function (): void {
    $this->postJson(route('diagnostics.radio-check'), ['message' => 'hi'])->assertUnauthorized();
});

it('authorizes the diagnostics presence channel only for users with a pilot profile', function (): void {
    // В phpunit.xml драйвер null: переключаем на reverb и заново регистрируем каналы.
    config(['broadcasting.default' => 'reverb']);
    Broadcast::forgetDrivers();
    require base_path('routes/channels.php');

    $pilot = User::factory()->withPilotProfile('Tester')->create();
    $stranger = User::factory()->create();

    $payload = ['socket_id' => '1234.5678', 'channel_name' => 'presence-diagnostics'];

    $this->actingAs($pilot)->post('/broadcasting/auth', $payload)
        ->assertOk()
        ->assertJsonPath('channel_data', fn (string $data): bool => json_decode($data, true)['user_info']['callsign'] === 'Tester');

    $this->actingAs($stranger)->post('/broadcasting/auth', $payload)->assertForbidden();
});
