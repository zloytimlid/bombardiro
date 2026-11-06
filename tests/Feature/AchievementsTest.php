<?php

declare(strict_types=1);

use App\Domain\Aircraft\Actions\SyncSimContent;
use App\Domain\Crews\Enums\CrewStatus;
use App\Domain\Crews\Models\Crew;
use App\Domain\FlightSessions\Enums\FlightSessionStatus;
use App\Domain\FlightSessions\Models\FlightSession;
use App\Domain\Missions\Models\Mission;
use App\Domain\Progression\Jobs\AwardAchievements;
use App\Domain\Progression\Models\Achievement;
use App\Domain\Progression\Models\UserAchievement;
use App\Domain\Progression\Support\AchievementRules;
use App\Models\User;
use Illuminate\Support\Facades\Event;

beforeEach(function (): void {
    app(SyncSimContent::class)->handle();
    Event::fake();
});

/**
 * Завершённый вылет с разбором: игрок — хвостовой стрелок.
 *
 * @param  array<string, mixed>  $overrides
 */
function finishedSession(User $user, array $overrides = []): FlightSession
{
    $crew = Crew::factory()->create(['owner_id' => $user->id, 'mission_id' => Mission::latestPublished('milk-run')?->id, 'status' => CrewStatus::Closed]);
    $session = FlightSession::factory()->create([
        'crew_id' => $crew->id,
        'mission_id' => $crew->mission_id,
        'host_user_id' => $user->id,
        'status' => FlightSessionStatus::Finished,
        'ended_at' => now(),
        'outcome' => 'landed',
        'score' => 87,
        'verified' => true,
        'debrief' => [
            'durationS' => 1800,
            'target' => ['status' => 'destroyed', 'percent' => 70],
            'timeOverTarget' => ['withinWindow' => true],
            'crew' => [['station' => 'pilot', 'health' => 'ok'], ['station' => 'tail_gunner', 'health' => 'ok']],
        ],
        ...$overrides,
    ]);

    $session->participants()->create([
        'user_id' => $user->id,
        'seat' => 'tail_gunner',
        'is_ai' => false,
        'joined_at' => now(),
        'metrics' => [['key' => 'kills', 'value' => 2, 'unit' => '']],
    ]);

    return $session;
}

it('evaluates declarative criteria trees', function (): void {
    $ctx = ['outcome' => 'landed', 'score' => 80, 'mission' => 'milk-run', 'tot.within' => null];

    expect(AchievementRules::matches(['metric' => 'outcome', 'op' => 'eq', 'value' => 'landed'], $ctx))->toBeTrue()
        ->and(AchievementRules::matches(['all' => [['metric' => 'score', 'op' => 'gte', 'value' => 80], ['metric' => 'mission', 'op' => 'in', 'value' => ['milk-run']]]], $ctx))->toBeTrue()
        ->and(AchievementRules::matches(['any' => [['metric' => 'score', 'op' => 'lte', 'value' => 10], ['metric' => 'outcome', 'op' => 'ne', 'value' => 'landed']]], $ctx))->toBeFalse()
        ->and(AchievementRules::matches(['metric' => 'tot.within', 'op' => 'eq', 'value' => true], $ctx))->toBeFalse()
        ->and(fn () => AchievementRules::matches(['metric' => 'outcome', 'op' => 'like', 'value' => 'x'], $ctx))->toThrow(InvalidArgumentException::class);
});

it('loads the achievement catalog from resources/sim', function (): void {
    expect(Achievement::query()->count())->toBeGreaterThanOrEqual(10)
        ->and(Achievement::query()->where('slug', 'bridge_buster')->value('title'))->toMatchArray(['ru' => 'Разрушитель мостов']);
});

it('awards achievements and profile stats once per verified sortie', function (): void {
    $user = User::factory()->withPilotProfile('Gunner')->create();
    $session = finishedSession($user);

    (new AwardAchievements($session->id))->handle();
    (new AwardAchievements($session->id))->handle();

    $slugs = UserAchievement::query()->where('user_id', $user->id)->with('achievement')->get()->pluck('achievement.slug')->all();

    expect($slugs)->toContain('first_sortie', 'bridge_buster', 'on_time', 'milk_run', 'gunner_double')
        ->not->toContain('full_crew', 'brenner', 'veteran')
        ->and($user->pilotProfile->refresh()->missions_total)->toBe(1)
        ->and($user->pilotProfile->flight_seconds_total)->toBe(1800);
});

it('gives no achievements for an unverified sortie but counts the flight time', function (): void {
    $user = User::factory()->withPilotProfile('Shady')->create();
    $session = finishedSession($user, ['verified' => false, 'flags' => ['overspeed']]);

    (new AwardAchievements($session->id))->handle();

    expect(UserAchievement::query()->where('user_id', $user->id)->count())->toBe(0)
        ->and($user->pilotProfile->refresh()->missions_total)->toBe(1);
});

it('ranks only verified finished sorties on the leaderboard', function (): void {
    $user = User::factory()->withPilotProfile('Leader')->create();

    finishedSession($user, ['score' => 95]);
    finishedSession($user, ['score' => 99, 'verified' => false]);
    finishedSession($user, ['score' => 70]);

    $rows = $this->actingAs($user)->getJson(route('api.leaderboards', ['mission' => 'milk-run', 'period' => 'week']))->assertOk()->json('data');

    expect($rows)->toHaveCount(2)
        ->and($rows[0]['score'])->toBe(95)
        ->and($rows[0]['players'])->toBe(['Leader'])
        ->and($rows[1]['rank'])->toBe(2);

    $this->actingAs($user)->getJson(route('api.leaderboards', ['mission' => 'nope']))->assertUnprocessable();
});

it('shows the hangar with profile, achievements and history', function (): void {
    $user = User::factory()->withPilotProfile('Hangar')->create();
    $session = finishedSession($user);

    (new AwardAchievements($session->id))->handle();

    $this->actingAs($user)->get(route('hangar'))->assertOk()
        ->assertInertia(fn ($page) => $page->component('hangar/Show')
            ->where('profile.callsign', 'Hangar')
            ->where('profile.missions_total', 1)
            ->has('achievements', Achievement::query()->count())
            ->has('history', 1));
});
