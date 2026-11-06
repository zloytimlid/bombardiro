<?php

declare(strict_types=1);

use App\Domain\Aircraft\Actions\SyncSimContent;
use App\Domain\Crews\Enums\CrewStatus;
use App\Domain\Crews\Models\Crew;
use App\Domain\FlightSessions\Enums\FlightSessionStatus;
use App\Domain\FlightSessions\Models\FlightSession;
use App\Domain\Missions\Models\Mission;
use App\Filament\Resources\FlightSessions\Pages\ListFlightSessions;
use App\Filament\Resources\Users\Pages\ListUsers;
use App\Models\User;
use Filament\Actions\Testing\TestAction;
use Livewire\Livewire;

/**
 * Этап 5: модерация в /admin — блокировка игроков и разбор вылетов с флагами.
 */
beforeEach(function (): void {
    app(SyncSimContent::class)->handle();
    $this->admin = User::factory()->admin()->withTwoFactor()->create();
    $this->actingAs($this->admin);
});

it('opens the moderation lists for an admin', function (): void {
    $this->get('/admin/users')->assertOk();
    $this->get('/admin/flight-sessions')->assertOk();
});

it('bans a player with a reason and unbans', function (): void {
    $player = User::factory()->withPilotProfile('Rogue')->create();

    Livewire::test(ListUsers::class)
        ->callAction(TestAction::make('ban')->table($player), data: ['reason' => 'speed hack'])
        ->assertHasNoActionErrors();

    expect($player->refresh()->banned_at)->not->toBeNull()
        ->and($player->ban_reason)->toBe('speed hack');

    Livewire::test(ListUsers::class)->callAction(TestAction::make('unban')->table($player));

    expect($player->refresh()->banned_at)->toBeNull();
});

it('accepts a flagged sortie into the leaderboard', function (): void {
    $crew = Crew::factory()->create(['owner_id' => $this->admin->id, 'mission_id' => Mission::latestPublished('milk-run')?->id, 'status' => CrewStatus::Closed]);
    $session = FlightSession::factory()->create([
        'crew_id' => $crew->id,
        'mission_id' => $crew->mission_id,
        'host_user_id' => $this->admin->id,
        'status' => FlightSessionStatus::Finished,
        'ended_at' => now(),
        'score' => 80,
        'verified' => false,
        'flags' => ['overspeed'],
    ]);

    Livewire::test(ListFlightSessions::class)
        ->assertCanSeeTableRecords([$session])
        ->callAction(TestAction::make('accept')->table($session));

    expect($session->refresh()->verified)->toBeTrue()
        ->and($session->review_decision)->toBe('accepted')
        ->and($session->reviewed_by)->toBe($this->admin->id);
});
