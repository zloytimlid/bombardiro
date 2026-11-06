<?php

use App\Domain\Aircraft\Actions\SyncSimContent;
use App\Domain\Crews\Enums\CrewStatus;
use App\Domain\Crews\Events\CrewReady;
use App\Domain\Crews\Events\SeatClaimed;
use App\Domain\Crews\Models\Crew;
use App\Domain\Crews\Models\CrewMember;
use App\Domain\FlightSessions\Events\SessionStarted;
use App\Domain\FlightSessions\Models\FlightSession;
use App\Domain\FlightSessions\Support\ChannelAuth;
use App\Models\User;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\Event;
use Inertia\Testing\AssertableInertia as Assert;

beforeEach(function (): void {
    app(SyncSimContent::class)->handle();
    Event::fake([SeatClaimed::class, CrewReady::class, SessionStarted::class]);
});

function createCrew(User $owner): Crew
{
    $response = test()->actingAs($owner)->postJson(route('api.crews.store'), ['mission' => 'milk-run', 'visibility' => 'private', 'max_players' => 8])->assertCreated();

    return Crew::query()->where('ulid', $response->json('data.ulid'))->firstOrFail();
}

it('creates a crew with an 8-character invite code and the owner as a member', function (): void {
    $owner = User::factory()->withPilotProfile()->create();
    $crew = createCrew($owner);

    expect($crew->invite_code)->toHaveLength(8)
        ->and($crew->status)->toBe(CrewStatus::Lobby)
        ->and($crew->hasMember($owner))->toBeTrue();
});

it('joins by invite code and refuses a full crew', function (): void {
    $owner = User::factory()->withPilotProfile()->create();
    $crew = createCrew($owner);
    $crew->update(['max_players' => 2]);

    $second = User::factory()->withPilotProfile()->create();
    $third = User::factory()->withPilotProfile()->create();

    $this->actingAs($second)->postJson(route('api.crews.join'), ['invite_code' => strtolower($crew->invite_code)])->assertOk()->assertJsonCount(2, 'data.members');
    $this->actingAs($third)->postJson(route('api.crews.join'), ['invite_code' => $crew->invite_code])->assertConflict();
    $this->actingAs($third)->postJson(route('api.crews.join'), ['invite_code' => 'ZZZZZZZZ'])->assertNotFound();
});

it('gives a seat to exactly one of two players: the second gets 409', function (): void {
    $owner = User::factory()->withPilotProfile()->create();
    $crew = createCrew($owner);
    $other = User::factory()->withPilotProfile()->create();

    $this->actingAs($other)->postJson(route('api.crews.join'), ['invite_code' => $crew->invite_code])->assertOk();

    $this->actingAs($owner)->postJson(route('api.crews.seats.claim', [$crew, 'pilot']))->assertOk();
    $this->actingAs($other)->postJson(route('api.crews.seats.claim', [$crew, 'pilot']))->assertConflict();
    $this->actingAs($other)->postJson(route('api.crews.seats.claim', [$crew, 'bombardier']))->assertOk();

    expect($crew->members()->whereNotNull('seat')->count())->toBe(2);
    Event::assertDispatched(SeatClaimed::class, 2);
});

it('enforces one player per seat in the database as well', function (): void {
    $owner = User::factory()->withPilotProfile()->create();
    $crew = createCrew($owner);
    $other = User::factory()->create();

    $crew->members()->create(['user_id' => $other->id, 'joined_at' => now()]);
    $crew->members()->where('user_id', $owner->id)->update(['seat' => 'pilot']);

    expect(fn () => $crew->members()->where('user_id', $other->id)->update(['seat' => 'pilot']))->toThrow(UniqueConstraintViolationException::class);
});

it('rejects a seat claim from a non-member and an unknown seat', function (): void {
    $crew = createCrew(User::factory()->withPilotProfile()->create());

    $this->actingAs(User::factory()->create())->postJson(route('api.crews.seats.claim', [$crew, 'pilot']))->assertForbidden();
    $this->actingAs($crew->owner)->postJson("/api/crews/{$crew->ulid}/seats/flight_engineer")->assertNotFound();
});

it('starts a session: AI fills empty seats, the lowest-RTT player hosts', function (): void {
    $owner = User::factory()->withPilotProfile()->create();
    $crew = createCrew($owner);
    $fast = User::factory()->withPilotProfile()->create();

    $this->actingAs($fast)->postJson(route('api.crews.join'), ['invite_code' => $crew->invite_code]);
    $this->actingAs($owner)->postJson(route('api.crews.seats.claim', [$crew, 'pilot']));
    $this->actingAs($fast)->postJson(route('api.crews.seats.claim', [$crew, 'tail_gunner']));
    $this->actingAs($owner)->postJson(route('api.crews.heartbeat', $crew), ['rtt_ms' => 90]);
    $this->actingAs($fast)->postJson(route('api.crews.heartbeat', $crew), ['rtt_ms' => 20]);

    // Не все готовы — старт запрещён.
    $this->actingAs($owner)->postJson(route('api.crews.ready', $crew), ['ready' => true])->assertOk();
    $this->actingAs($owner)->postJson(route('api.crews.start', $crew))->assertConflict();
    $this->actingAs($fast)->postJson(route('api.crews.start', $crew))->assertForbidden();

    $this->actingAs($fast)->postJson(route('api.crews.ready', $crew), ['ready' => true])->assertOk();
    $response = $this->actingAs($owner)->postJson(route('api.crews.start', $crew))->assertCreated();

    $session = FlightSession::query()->where('ulid', $response->json('data.session'))->firstOrFail();

    expect($session->host_user_id)->toBe($fast->id)
        ->and($session->participants()->count())->toBe(8)
        ->and($session->participants()->where('is_ai', true)->count())->toBe(6)
        ->and($session->mission_version)->toBe(1)
        ->and($crew->refresh()->status)->toBe(CrewStatus::InSession);

    Event::assertDispatched(SessionStarted::class);
});

it('cannot be ready without a seat; the owner can pick the host and difficulty', function (): void {
    $owner = User::factory()->withPilotProfile()->create();
    $crew = createCrew($owner);

    $this->actingAs($owner)->postJson(route('api.crews.ready', $crew), ['ready' => true])->assertConflict();
    $this->actingAs($owner)->patchJson(route('api.crews.configure', $crew), ['difficulty' => 'historical', 'host_user_id' => $owner->id])->assertOk()
        ->assertJsonPath('data.difficulty', 'historical')
        ->assertJsonPath('data.host_user_id', $owner->id);
    $this->actingAs($owner)->patchJson(route('api.crews.configure', $crew), ['host_user_id' => 999999])->assertStatus(422);
});

it('holds a disconnected player seat for 120 s during a session, then frees it', function (): void {
    $owner = User::factory()->withPilotProfile()->create();
    $crew = createCrew($owner);
    $other = User::factory()->withPilotProfile()->create();

    $this->actingAs($other)->postJson(route('api.crews.join'), ['invite_code' => $crew->invite_code]);
    $this->actingAs($owner)->postJson(route('api.crews.seats.claim', [$crew, 'pilot']));
    $this->actingAs($other)->postJson(route('api.crews.seats.claim', [$crew, 'bombardier']));
    $crew->members()->update(['is_ready' => true]);
    $this->actingAs($owner)->postJson(route('api.crews.start', $crew))->assertCreated();

    // Владелец «пропал» 60 с назад — место ещё его.
    $crew->members()->where('user_id', $owner->id)->update(['last_seen_at' => now()->subSeconds(60)]);
    $this->actingAs($other)->postJson(route('api.crews.seats.claim', [$crew, 'pilot']))->assertConflict();

    // Прошло больше 120 с — место можно занять, у бомбардира теперь ИИ.
    $crew->members()->where('user_id', $owner->id)->update(['last_seen_at' => now()->subSeconds(CrewMember::SEAT_HOLD_SECONDS + 5)]);
    $this->actingAs($other)->postJson(route('api.crews.seats.claim', [$crew, 'pilot']))->assertOk();

    $session = $crew->sessions()->firstOrFail();

    expect($crew->memberFor($other)?->seat?->value)->toBe('pilot')
        ->and($session->participants()->where('seat', 'bombardier')->whereNull('left_at')->value('is_ai'))->toBeTrue();
});

it('renders the lobby for members only', function (): void {
    $owner = User::factory()->withPilotProfile()->create();
    $crew = createCrew($owner);

    $this->actingAs($owner)->get(route('crews.show', $crew))->assertOk()
        ->assertInertia(fn (Assert $page) => $page->component('crews/Lobby')->where('crew.invite_code', $crew->invite_code)->where('userId', $owner->id));
    $this->actingAs(User::factory()->create())->get(route('crews.show', $crew))->assertForbidden();
});

it('authorises the game channels for participants only', function (): void {
    $owner = User::factory()->withPilotProfile()->create();
    $guest = User::factory()->withPilotProfile()->create();
    $crew = createCrew($owner);
    $this->actingAs($guest)->postJson(route('api.crews.join'), ['invite_code' => $crew->invite_code]);
    $this->actingAs($owner)->postJson(route('api.crews.seats.claim', [$crew, 'pilot']));
    $this->actingAs($guest)->postJson(route('api.crews.seats.claim', [$crew, 'bombardier']));
    $crew->members()->update(['is_ready' => true]);
    $this->actingAs($owner)->postJson(route('api.crews.heartbeat', $crew), ['rtt_ms' => 5]);
    $session = FlightSession::query()->where('ulid', $this->actingAs($owner)->postJson(route('api.crews.start', $crew))->json('data.session'))->firstOrFail();
    $stranger = User::factory()->create();

    expect(ChannelAuth::crew($owner, $crew->ulid))->toMatchArray(['id' => $owner->id])
        ->and(ChannelAuth::crew($stranger, $crew->ulid))->toBeFalse()
        ->and(ChannelAuth::session($guest, $session->ulid))->toBeTrue()
        ->and(ChannelAuth::session($stranger, $session->ulid))->toBeFalse()
        // Канал ввода места: владелец места и хост — да, остальные — нет.
        ->and(ChannelAuth::input($guest, $session->ulid, 'bombardier'))->toBeTrue()
        ->and(ChannelAuth::input($guest, $session->ulid, 'pilot'))->toBeFalse()
        ->and(ChannelAuth::input($owner, $session->ulid, 'bombardier'))->toBeTrue()
        ->and(ChannelAuth::input($owner, $session->ulid, 'flight_engineer'))->toBeFalse();
});
