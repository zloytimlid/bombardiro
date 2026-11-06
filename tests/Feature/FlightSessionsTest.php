<?php

use App\Domain\Aircraft\Actions\SyncSimContent;
use App\Domain\Crews\Enums\CrewStatus;
use App\Domain\Crews\Models\Crew;
use App\Domain\FlightSessions\Enums\FlightSessionStatus;
use App\Domain\FlightSessions\Events\HostChanged;
use App\Domain\FlightSessions\Events\SessionEnded;
use App\Domain\FlightSessions\Models\FlightSession;
use App\Domain\FlightSessions\Support\Protocol;
use App\Domain\Missions\Models\Mission;
use App\Models\User;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Event;
use Illuminate\Testing\TestResponse;

beforeEach(function (): void {
    app(SyncSimContent::class)->handle();
    Event::fake([HostChanged::class, SessionEnded::class]);
});

/**
 * Экипаж из двух игроков в вылете: хост (пилот) и бомбардир.
 *
 * @return array{0: FlightSession, 1: User, 2: User}
 */
function activeSession(): array
{
    $host = User::factory()->withPilotProfile()->create();
    $guest = User::factory()->withPilotProfile()->create();
    $crew = Crew::factory()->create(['owner_id' => $host->id, 'mission_id' => Mission::latestPublished('milk-run')?->id, 'status' => CrewStatus::InSession]);

    $crew->members()->create(['user_id' => $host->id, 'seat' => 'pilot', 'is_ready' => true, 'rtt_ms' => 30, 'last_seen_at' => now(), 'joined_at' => now()]);
    $crew->members()->create(['user_id' => $guest->id, 'seat' => 'bombardier', 'is_ready' => true, 'rtt_ms' => 50, 'last_seen_at' => now(), 'joined_at' => now()]);

    $session = FlightSession::factory()->create(['crew_id' => $crew->id, 'mission_id' => $crew->mission_id, 'host_user_id' => $host->id]);

    foreach (['pilot' => $host->id, 'bombardier' => $guest->id] as $seat => $user) {
        $session->participants()->create(['user_id' => $user, 'seat' => $seat, 'is_ai' => false, 'joined_at' => now()]);
    }

    Cache::put(Protocol::hostSeenKey($session->ulid), microtime(true), 600);

    return [$session, $host, $guest];
}

/**
 * @param  list<array{seq: int, tick: int, type: string, payload: array<string, mixed>}>  $events
 */
function postEvents(FlightSession $session, User $host, array $events): TestResponse
{
    return test()->actingAs($host)->postJson(route('api.sessions.events', $session), ['v' => Protocol::VERSION, 'events' => $events]);
}

it('bootstraps the session with mission, config, seed, roster, host and protocol version', function (): void {
    [$session, $host, $guest] = activeSession();

    $this->actingAs($guest)->getJson(route('api.sessions.bootstrap', $session))->assertOk()
        ->assertJsonPath('data.v', Protocol::VERSION)
        ->assertJsonPath('data.host_user_id', $host->id)
        ->assertJsonPath('data.seat', 'bombardier')
        ->assertJsonPath('data.roster.0.seat', 'pilot')
        ->assertJsonPath('data.roster.0.is_ai', false)
        ->assertJsonPath('data.roster.1.is_ai', true)
        ->assertJsonPath('data.mission.id', 'milk-run')
        ->assertJsonPath('data.aircraft_config.id', 'b25j')
        ->assertJsonPath('data.seed', $session->seed);

    $this->actingAs(User::factory()->create())->getJson(route('api.sessions.bootstrap', $session))->assertForbidden();
});

it('accepts the event journal from the host only, idempotently by seq', function (): void {
    [$session, $host, $guest] = activeSession();
    $batch = [
        ['seq' => 1, 'tick' => 10, 'type' => 'phase', 'payload' => ['from' => 'preflight', 'to' => 'takeoff']],
        ['seq' => 2, 'tick' => 900, 'type' => 'phase', 'payload' => ['from' => 'takeoff', 'to' => 'formup']],
    ];

    postEvents($session, $host, $batch)->assertOk()->assertJsonPath('inserted', 2)->assertJsonPath('last_seq', 2);
    postEvents($session, $host, $batch)->assertOk()->assertJsonPath('inserted', 0);
    postEvents($session, $guest, $batch)->assertForbidden();
    postEvents($session, $host, [['seq' => 0, 'tick' => 0, 'type' => 'Bad Type', 'payload' => []]])->assertUnprocessable();
    $this->actingAs($host)->postJson(route('api.sessions.events', $session), ['v' => 99, 'events' => []])->assertConflict();

    expect($session->events()->count())->toBe(2);
});

it('stores the migration snapshot in Redis and never overwrites a newer one', function (): void {
    [$session, $host, $guest] = activeSession();

    $this->actingAs($host)->putJson(route('api.sessions.snapshot.store', $session), ['v' => Protocol::VERSION, 'tick' => 600, 'state' => ['phase' => 'route']])->assertOk();
    $this->actingAs($host)->putJson(route('api.sessions.snapshot.store', $session), ['v' => Protocol::VERSION, 'tick' => 300, 'state' => ['phase' => 'takeoff']])->assertOk();
    $this->actingAs($guest)->putJson(route('api.sessions.snapshot.store', $session), ['v' => Protocol::VERSION, 'tick' => 900, 'state' => []])->assertForbidden();

    $this->actingAs($guest)->getJson(route('api.sessions.snapshot.show', $session))->assertOk()
        ->assertJsonPath('data.tick', 600)
        ->assertJsonPath('data.state.phase', 'route');
});

it('migrates the host only when the host has gone silent', function (): void {
    [$session, $host, $guest] = activeSession();

    // Хост на связи (отметка пульса впереди порога больше, чем сервер готов ждать) — смены нет, ответ сразу.
    Cache::put(Protocol::hostSeenKey($session->ulid), now()->getPreciseTimestamp(3) / 1000 + 3, 600);
    $this->actingAs($guest)->postJson(route('api.sessions.host-lost', $session))->assertOk()->assertJsonPath('host_user_id', $host->id);
    Event::assertNotDispatched(HostChanged::class);

    // Хост молчит дольше порога — выбирается следующий по RTT.
    Cache::put(Protocol::hostSeenKey($session->ulid), microtime(true) - 10, 600);
    $this->actingAs($guest)->postJson(route('api.sessions.host-lost', $session))->assertOk()->assertJsonPath('host_user_id', $guest->id);

    Event::assertDispatched(HostChanged::class, fn (HostChanged $e): bool => $e->hostUserId === $guest->id);

    // Новый хост теперь пишет журнал, старый — нет.
    postEvents($session, $guest, [['seq' => 1, 'tick' => 1, 'type' => 'host_changed', 'payload' => []]])->assertOk();
    postEvents($session, $host, [['seq' => 2, 'tick' => 2, 'type' => 'phase', 'payload' => []]])->assertForbidden();
});

it('waits briefly for the silence threshold instead of making the client report again', function (): void {
    [$session, $host, $guest] = activeSession();

    // Хост пропал 0,5 с назад: до порога 0,5 с — сервер дожидается его в этом же запросе и выбирает нового хоста.
    Cache::put(Protocol::hostSeenKey($session->ulid), now()->getPreciseTimestamp(3) / 1000 - 0.5, 600);
    $started = microtime(true);

    $this->actingAs($guest)->postJson(route('api.sessions.host-lost', $session))->assertOk()->assertJsonPath('host_user_id', $guest->id);

    expect(microtime(true) - $started)->toBeGreaterThan(0.4)->toBeLessThan(Protocol::HOST_LOST_WAIT_SECONDS + 1);
    Event::assertDispatched(HostChanged::class);
});

it('measures host silence by request arrival, not by when PHP got to the request', function (): void {
    [$session, $host, $guest] = activeSession();
    $now = now()->getPreciseTimestamp(3) / 1000;

    // Сообщение о потере пришло 3 с назад и ждало в очереди PHP-FPM, а пульс хоста пришёл через 1 с после него
    // и уже обработан. По времени прихода хост на связи — смены нет (по времени обработки «молчал» бы 2 с).
    Cache::put(Protocol::hostSeenKey($session->ulid), $now - 2, 600);
    $this->actingAs($guest)->withServerVariables(['REQUEST_START' => sprintf('%.3f', $now - 3)])
        ->postJson(route('api.sessions.host-lost', $session))->assertOk()->assertJsonPath('host_user_id', $host->id);
    Event::assertNotDispatched(HostChanged::class);

    // Подделанное «время прихода» из будущего игнорируется: считается текущее время, хост молчит 2 с.
    $this->actingAs($guest)->withServerVariables(['REQUEST_START' => sprintf('%.3f', $now + 60)])
        ->postJson(route('api.sessions.host-lost', $session))->assertOk()->assertJsonPath('host_user_id', $guest->id);
});

it('gives a freshly elected host time to restore the world before it can be voted out', function (): void {
    [$session, $host, $guest] = activeSession();
    $third = User::factory()->withPilotProfile()->create();

    $session->crew->members()->create(['user_id' => $third->id, 'seat' => 'tail_gunner', 'is_ready' => true, 'rtt_ms' => 80, 'last_seen_at' => now(), 'joined_at' => now()]);
    Cache::put(Protocol::hostSeenKey($session->ulid), microtime(true) - 10, 600);

    $this->actingAs($third)->postJson(route('api.sessions.host-lost', $session))->assertOk()->assertJsonPath('host_user_id', $guest->id);

    // Через 3 с новый хост ещё восстанавливает мир и молчит — смены нет (льготный срок 5 с).
    $this->travel(3)->seconds();
    $this->actingAs($third)->postJson(route('api.sessions.host-lost', $session))->assertOk()->assertJsonPath('host_user_id', $guest->id);

    Event::assertDispatchedTimes(HostChanged::class, 1);
});

it('records presence and RTT through the heartbeat', function (): void {
    [$session, $host, $guest] = activeSession();

    $this->actingAs($guest)->postJson(route('api.sessions.rtt', $session), ['rtt_ms' => 77])->assertOk()->assertJsonPath('host_user_id', $host->id);

    expect($session->crew->memberFor($guest)?->rtt_ms)->toBe(77);
});

it('computes the debrief on the server from the journal and flags the implausible', function (): void {
    [$session, $host, $guest] = activeSession();
    $mission = $session->mission->definition;
    $origin = $session->mission->theatre;
    $k = cos(deg2rad((float) $origin->origin_lat));
    $aimX = ((float) $mission['target']['aim_point']['lon'] - (float) $origin->origin_lon) * 111320 * $k;
    $aimY = ((float) $mission['target']['aim_point']['lat'] - (float) $origin->origin_lat) * 110574;
    $at = (int) round($mission['time_over_target']['at_s'] * 60);

    postEvents($session, $host, [
        ['seq' => 1, 'tick' => 10, 'type' => 'phase', 'payload' => ['from' => 'preflight', 'to' => 'takeoff']],
        ['seq' => 2, 'tick' => $at, 'type' => 'bombs_released', 'payload' => ['emergency' => false, 'count' => 4, 'armed' => true]],
        ['seq' => 3, 'tick' => $at + 1500, 'type' => 'bomb_impact', 'payload' => ['x' => (int) round($aimX), 'y' => (int) round($aimY), 'armed' => true, 'miss_m' => 3, 'type' => 'AN-M64']],
        ['seq' => 4, 'tick' => $at + 1600, 'type' => 'fighter_down', 'payload' => ['id' => 9]],
    ])->assertOk();

    $crew = array_map(fn (string $s): array => ['station' => $s, 'health' => 'ok', 'bailedOut' => false], ['pilot', 'copilot', 'bombardier', 'navigator', 'top_gunner', 'radio', 'waist_gunner', 'tail_gunner']);

    $this->actingAs($host)->postJson(route('api.sessions.finish', $session), [
        'v' => Protocol::VERSION,
        'outcome' => 'landed',
        'last_seq' => 4,
        'damage_share' => 0,
        'crew' => $crew,
        'stations' => ['pilot' => [['key' => 'touchdown_vs', 'value' => 1.5, 'unit' => 'm/s']]],
        'track' => [['t' => 0, 'x' => 0, 'y' => 0, 'z' => 15], ['t' => 5, 'x' => 0, 'y' => 400, 'z' => 40]],
        'duration_s' => 3200,
    ])->assertAccepted();

    $session->refresh();

    // Очередь в тестах синхронная: разбор уже посчитан.
    expect($session->status)->toBe(FlightSessionStatus::Finished)
        ->and($session->debrief['target']['status'])->toBe('destroyed')
        ->and($session->debrief['timeOverTarget']['withinWindow'])->toBeTrue()
        ->and($session->debrief['score']['parts']['aircraft'])->toBe(1)
        ->and($session->score)->toBe(100 - (int) round(0))
        ->and($session->flags)->toBe(['kill_before_spawn', 'kills_over_spawned'])
        ->and($session->verified)->toBeFalse()
        ->and($session->crew->status)->toBe(CrewStatus::Lobby)
        ->and($session->participants()->where('user_id', $host->id)->value('metrics'))->not->toBeNull();

    Event::assertDispatched(SessionEnded::class);

    // Разбор одинаковый для всех участников.
    $a = $this->actingAs($host)->getJson(route('api.sessions.debrief', $session))->assertOk()->json('data');
    $b = $this->actingAs($guest)->getJson(route('api.sessions.debrief', $session))->assertOk()->json('data');

    expect($a)->toBe($b)->and($a['score']['total'])->toBe($session->score);
});

it('flags more bombs than loaded and impossible speed', function (): void {
    [$session, $host] = activeSession();
    $events = [];

    for ($i = 1; $i <= 6; $i++) {
        $events[] = ['seq' => $i, 'tick' => $i, 'type' => 'bomb_impact', 'payload' => ['x' => 0, 'y' => 0, 'armed' => false, 'miss_m' => 9999]];
    }

    postEvents($session, $host, $events)->assertOk();
    $this->actingAs($host)->postJson(route('api.sessions.finish', $session), [
        'v' => Protocol::VERSION, 'outcome' => 'crashed', 'last_seq' => 6, 'damage_share' => 1, 'crew' => [], 'stations' => [],
        'track' => [['t' => 0, 'x' => 0, 'y' => 0, 'z' => 0], ['t' => 5, 'x' => 0, 'y' => 5000, 'z' => 0]], 'duration_s' => 10,
    ])->assertAccepted();

    expect($session->refresh()->flags)->toBe(['bombs_over_load', 'overspeed']);
});
