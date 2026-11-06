<?php

declare(strict_types=1);

use App\Domain\Aircraft\Actions\SyncSimContent;
use App\Domain\Crews\Enums\CrewStatus;
use App\Domain\Crews\Models\Crew;
use App\Domain\FlightSessions\Models\FlightSession;
use App\Domain\FlightSessions\Support\ChannelAuth;
use App\Domain\Missions\Models\Mission;
use App\Models\User;
use Illuminate\Support\Facades\Event;

/**
 * Этап 6: звено до 4 экипажей — один сид и миссия, свой вылет у каждого экипажа, место в строю.
 */
beforeEach(function (): void {
    app(SyncSimContent::class)->handle();
    Event::fake();
});

function readyCrew(string $mission = 'avignon'): array
{
    $owner = User::factory()->withPilotProfile()->create();
    $crew = Crew::factory()->create(['owner_id' => $owner->id, 'mission_id' => Mission::latestPublished($mission)?->id, 'status' => CrewStatus::Lobby]);
    $crew->members()->create(['user_id' => $owner->id, 'seat' => 'pilot', 'is_ready' => true, 'last_seen_at' => now(), 'joined_at' => now()]);

    return [$crew, $owner];
}

it('forms a flight of up to four crews that start together with one seed', function (): void {
    [$lead, $leadOwner] = readyCrew();
    $flight = $this->actingAs($leadOwner)->postJson("/api/crews/{$lead->ulid}/flight")->assertCreated()->json('data');

    $wings = [];

    foreach (range(1, 3) as $i) {
        [$crew, $owner] = readyCrew('milk-run');
        $this->actingAs($owner)->postJson("/api/crews/{$crew->ulid}/flight/join", ['invite_code' => $flight['invite_code']])->assertOk()
            ->assertJsonPath('data.crews.'.$i.'.slot', $i);
        // Миссия ведущего переходит на звено.
        expect($crew->refresh()->mission->slug)->toBe('avignon');
        $wings[] = [$crew, $owner];
    }

    [$fifth, $fifthOwner] = readyCrew();
    $this->actingAs($fifthOwner)->postJson("/api/crews/{$fifth->ulid}/flight/join", ['invite_code' => $flight['invite_code']])->assertConflict();

    // Экипаж звена не стартует сам.
    $this->actingAs($wings[0][1])->postJson("/api/crews/{$wings[0][0]->ulid}/start")->assertConflict();
    $this->actingAs($wings[0][1])->postJson("/api/flights/{$flight['ulid']}/start")->assertForbidden();

    $sessions = $this->actingAs($leadOwner)->postJson("/api/flights/{$flight['ulid']}/start")->assertCreated()->json('data.sessions');

    expect($sessions)->toHaveCount(4)
        ->and(FlightSession::query()->whereIn('ulid', array_column($sessions, 'session'))->pluck('seed')->unique()->count())->toBe(1)
        ->and(array_column($sessions, 'slot'))->toBe([0, 1, 2, 3]);

    $this->actingAs($wings[1][1])->getJson("/api/sessions/{$sessions[2]['session']}/bootstrap")->assertOk()
        ->assertJsonPath('data.flight.slot', 2)
        ->assertJsonPath('data.flight.ulid', $flight['ulid'])
        ->assertJsonCount(4, 'data.flight.slots');

    expect(ChannelAuth::flight($wings[2][1], $flight['ulid']))->toBeArray()
        ->and(ChannelAuth::flight($fifthOwner, $flight['ulid']))->toBeFalse();
});

it('refuses to start while a crew of the flight is not ready, and closes the flight when the leader leaves', function (): void {
    [$lead, $leadOwner] = readyCrew();
    [$wing, $wingOwner] = readyCrew();
    $flight = $this->actingAs($leadOwner)->postJson("/api/crews/{$lead->ulid}/flight")->json('data');

    $this->actingAs($wingOwner)->postJson("/api/crews/{$wing->ulid}/flight/join", ['invite_code' => $flight['invite_code']])->assertOk();
    $wing->members()->update(['is_ready' => false]);

    $this->actingAs($leadOwner)->postJson("/api/flights/{$flight['ulid']}/start")->assertConflict();

    $this->actingAs($leadOwner)->deleteJson("/api/crews/{$lead->ulid}/flight")->assertOk();

    expect($wing->refresh()->flight_id)->toBeNull()
        ->and($lead->refresh()->flight_id)->toBeNull();
});
