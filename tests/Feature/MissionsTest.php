<?php

use App\Domain\Aircraft\Actions\SyncSimContent;
use App\Domain\Missions\Actions\ImportMission;
use App\Domain\Missions\Enums\MissionDifficulty;
use App\Domain\Missions\Models\Mission;
use App\Domain\Missions\Support\MissionSchema;
use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Inertia\Testing\AssertableInertia as Assert;

beforeEach(function (): void {
    app(SyncSimContent::class)->handle();
});

/**
 * @return array<string, mixed>
 */
function milkRunDefinition(): array
{
    return json_decode((string) file_get_contents(resource_path('sim/missions/milk-run.json')), true, flags: JSON_THROW_ON_ERROR);
}

it('validates missions against the generated JSON Schema', function (): void {
    $schema = app(MissionSchema::class);
    $valid = milkRunDefinition();

    expect($schema->errors($valid))->toBe([]);

    $broken = $valid;
    unset($broken['waypoints']);
    expect($schema->errors($broken))->not->toBe([]);

    // Произвольный код в миссии запрещён (раздел 8.3): неизвестное действие триггера не проходит.
    $code = $valid;
    $code['triggers'][0]['then'] = [['type' => 'eval', 'code' => 'alert(1)']];
    expect($schema->errors($code))->not->toBe([]);
});

it('rejects an invalid mission on import', function (): void {
    $definition = milkRunDefinition();
    $definition['difficulty'] = 'impossible';

    app(ImportMission::class)->handle($definition);
})->throws(ValidationException::class);

it('rejects a mission for an unknown theatre', function (): void {
    $definition = milkRunDefinition();
    $definition['id'] = 'nowhere';
    $definition['theatre'] = 'atlantis';

    app(ImportMission::class)->handle($definition);
})->throws(ValidationException::class);

it('creates a new version when a published mission changes and keeps the old one', function (): void {
    $definition = milkRunDefinition();
    $definition['time_over_target']['at_s'] = 1500;

    $mission = app(ImportMission::class)->handle($definition);

    expect($mission->version)->toBe(2)
        ->and($mission->definition['version'])->toBe(2)
        ->and(Mission::query()->where('slug', 'milk-run')->count())->toBe(2)
        ->and(Mission::latestPublished('milk-run')?->version)->toBe(2)
        ->and(Mission::query()->where('slug', 'milk-run')->where('version', 1)->value('definition'))->toMatchArray(['time_over_target' => ['at_s' => 1460, 'window_s' => 60]]);
});

it('edits a draft in place', function (): void {
    $definition = milkRunDefinition();
    $definition['id'] = 'draft-run';

    $draft = app(ImportMission::class)->handle($definition, publish: false);
    $definition['seed'] = 77;
    $again = app(ImportMission::class)->handle($definition, publish: false);

    expect($again->is($draft))->toBeTrue()
        ->and($again->version)->toBe(1)
        ->and($again->definition['seed'])->toBe(77);
});

it('enforces the difficulty and version constraints in the database', function (): void {
    expect(Mission::factory()->create()->difficulty)->toBe(MissionDifficulty::Training);
    expect(fn () => Mission::factory()->make(['difficulty' => 'insane']))->toThrow(ValueError::class);

    $theatre = Mission::query()->firstOrFail()->theatre_id;
    $row = ['slug' => 'x', 'title' => '{}', 'theatre_id' => $theatre, 'definition' => '{}', 'sources' => '[]', 'created_at' => now(), 'updated_at' => now()];

    expect(fn () => DB::table('missions')->insert([...$row, 'version' => 1, 'difficulty' => 'insane']))->toThrow(QueryException::class);
});

it('rejects a zero version in the database', function (): void {
    $theatre = Mission::query()->firstOrFail()->theatre_id;

    DB::table('missions')->insert(['slug' => 'x', 'title' => '{}', 'theatre_id' => $theatre, 'definition' => '{}', 'sources' => '[]', 'version' => 0, 'difficulty' => 'training']);
})->throws(QueryException::class);

it('lists published missions in the catalog', function (): void {
    Mission::factory()->draft()->create(['slug' => 'secret']);

    $this->actingAs(User::factory()->create())
        ->get(route('missions.index'))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('missions/Index')
            ->has('missions', 3)
            ->where('missions.0.slug', 'milk-run')
            ->where('missions.1.slug', 'avignon')
            ->where('missions.2.slug', 'brenner')
            ->where('missions.0.placeholder', true));
});

it('opens a solo sortie with the mission, aircraft and theatre', function (): void {
    $this->actingAs(User::factory()->create())
        ->get(route('missions.solo', 'milk-run'))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('missions/Solo')
            ->where('mission.slug', 'milk-run')
            ->where('mission.definition.target.id', 'rail-bridge')
            ->where('aircraftConfig.id', 'b25j')
            ->where('theatre.definition.slug', 'corsica')
            ->has('seed'));

    $this->actingAs(User::factory()->create())->get(route('missions.solo', 'unknown'))->assertNotFound();
});

it('serves the mission catalog API', function (): void {
    $this->getJson(route('api.missions.index'))->assertUnauthorized();

    $user = User::factory()->create();

    $this->actingAs($user)->getJson(route('api.missions.index'))
        ->assertOk()
        ->assertJsonPath('data.0.slug', 'milk-run');

    $this->actingAs($user)->getJson(route('api.missions.show', 'milk-run'))
        ->assertOk()
        ->assertJsonPath('data.theatre', 'corsica')
        ->assertJsonPath('data.definition.loadout.bombs.0.type', 'AN-M64');
});
