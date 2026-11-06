<?php

declare(strict_types=1);

use App\Domain\Aircraft\Actions\SyncSimContent;
use App\Domain\Campaigns\Actions\CampaignService;
use App\Domain\Campaigns\Models\Campaign;
use App\Domain\Campaigns\Models\CampaignProgress;
use App\Domain\Crews\Enums\CrewStatus;
use App\Domain\Crews\Models\Crew;
use App\Domain\FlightSessions\Actions\FlightSessionService;
use App\Domain\FlightSessions\Enums\FlightSessionStatus;
use App\Domain\FlightSessions\Jobs\BuildReplay;
use App\Domain\FlightSessions\Jobs\ComputeDebrief;
use App\Domain\FlightSessions\Jobs\PurgeOldReplays;
use App\Domain\FlightSessions\Models\FlightSession;
use App\Domain\FlightSessions\Models\FlightSessionReplay;
use App\Domain\FlightSessions\Support\DebriefCalculator;
use App\Domain\Missions\Models\Mission;
use App\Models\User;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;

/**
 * Этап 6: кампания с состоянием борта и повторы вылетов.
 */
beforeEach(function (): void {
    app(SyncSimContent::class)->handle();
    Event::fake();
    Storage::fake();
});

function campaignCrew(User $owner): Crew
{
    $crew = Crew::factory()->create(['owner_id' => $owner->id, 'mission_id' => Mission::latestPublished('brenner')?->id, 'status' => CrewStatus::Lobby]);
    $crew->members()->create(['user_id' => $owner->id, 'seat' => 'pilot', 'is_ready' => true, 'last_seen_at' => now(), 'joined_at' => now()]);

    return $crew;
}

it('loads the campaign and enrolls a crew on its first mission', function (): void {
    $owner = User::factory()->withPilotProfile()->create();
    $crew = campaignCrew($owner);

    expect(Campaign::query()->where('slug', 'mto-1944')->value('missions'))->toBe(['milk-run', 'avignon', 'brenner']);

    $this->actingAs($owner)->postJson("/api/crews/{$crew->ulid}/campaign", ['campaign' => 'mto-1944'])->assertOk()
        ->assertJsonPath('data.campaign.slug', 'mto-1944')
        ->assertJsonPath('data.campaign.step', 0)
        ->assertJsonPath('data.mission.slug', 'milk-run');

    $this->actingAs(User::factory()->withPilotProfile()->create())->postJson("/api/crews/{$crew->ulid}/campaign", ['campaign' => 'mto-1944'])->assertForbidden();
});

it('carries damage into the next sortie, repairs by days and advances on a landing', function (): void {
    Queue::fake();

    $owner = User::factory()->withPilotProfile()->create();
    $crew = campaignCrew($owner);

    $this->actingAs($owner)->postJson("/api/crews/{$crew->ulid}/campaign", ['campaign' => 'mto-1944'])->assertOk();

    $session = app(FlightSessionService::class)->start($crew->refresh(), $owner);

    expect($session->campaign_progress_id)->toBe($crew->campaign_progress_id);

    $session->update([
        'status' => FlightSessionStatus::Finished,
        'outcome' => 'landed',
        'debrief' => ['summary' => ['outcome' => 'landed', 'zones' => ['engine_left' => 0.4, 'tail' => 0.9], 'crew' => [['station' => 'pilot', 'health' => 'wounded', 'bailedOut' => false]], 'duration_s' => 1500]],
    ]);

    (new ComputeDebrief($session->id))->handle(app(DebriefCalculator::class), app(CampaignService::class));

    $progress = CampaignProgress::query()->findOrFail($crew->campaign_progress_id);

    expect($progress->step)->toBe(1)
        ->and($progress->day)->toBe(2)
        // JSONB не хранит порядок ключей.
        ->and($progress->airframe_state['zones'])->toEqual(['engine_left' => 0.4, 'tail' => 0.9])
        ->and($progress->crew_state)->toBe(['pilot' => 'wounded'])
        ->and($crew->refresh()->mission->slug)->toBe('avignon');

    // Новый вылет кампании: борт начинает с теми же повреждениями.
    $crew->refresh()->update(['status' => CrewStatus::Lobby]);
    $next = app(FlightSessionService::class)->start($crew->refresh(), $owner);

    $this->actingAs($owner)->getJson("/api/sessions/{$next->ulid}/bootstrap")->assertOk()
        ->assertJsonPath('data.airframe_zones.engine_left', 0.4);

    // День ремонта: +35 % прочности, исправное убирается из списка.
    $crew->refresh()->update(['status' => CrewStatus::Lobby]);
    $this->actingAs($owner)->postJson("/api/crews/{$crew->ulid}/campaign/repair")->assertOk()
        ->assertJsonPath('data.campaign.day', 3)
        ->assertJsonPath('data.campaign.damaged', ['engine_left' => 0.75]);
});

it('builds a downloadable replay and purges old unpinned ones', function (): void {
    $owner = User::factory()->withPilotProfile()->create();
    $crew = campaignCrew($owner);
    $session = FlightSession::factory()->create(['crew_id' => $crew->id, 'mission_id' => $crew->mission_id, 'host_user_id' => $owner->id, 'status' => FlightSessionStatus::Finished, 'debrief' => ['track' => [['t' => 0, 'x' => 1, 'y' => 2, 'z' => 3]]]]);

    $session->events()->create(['seq' => 1, 'tick' => 5, 'type' => 'phase', 'payload' => ['to' => 'takeoff'], 'created_at' => now()]);

    (new BuildReplay($session->id))->handle();

    $replay = FlightSessionReplay::query()->where('flight_session_id', $session->id)->firstOrFail();
    $data = json_decode((string) gzdecode((string) Storage::get($replay->storage_path)), true);

    expect($data['events'][0]['type'])->toBe('phase')
        ->and($data['seed'])->toBe($session->seed)
        ->and($data['track'][0]['x'])->toBe(1);

    $this->actingAs($owner)->get("/api/sessions/{$session->ulid}/replay")->assertOk()->assertHeader('Content-Type', 'application/gzip');
    $this->actingAs(User::factory()->create())->get("/api/sessions/{$session->ulid}/replay")->assertForbidden();

    FlightSessionReplay::query()->whereKey($replay->id)->update(['created_at' => now()->subDays(31)]);
    $this->actingAs($owner)->postJson("/api/sessions/{$session->ulid}/replay/pin")->assertOk()->assertJsonPath('pinned', true);
    (new PurgeOldReplays)->handle();
    expect(FlightSessionReplay::query()->count())->toBe(1);

    $this->actingAs($owner)->postJson("/api/sessions/{$session->ulid}/replay/pin")->assertJsonPath('pinned', false);
    (new PurgeOldReplays)->handle();
    expect(FlightSessionReplay::query()->count())->toBe(0);
    Storage::assertMissing($replay->storage_path);
});
