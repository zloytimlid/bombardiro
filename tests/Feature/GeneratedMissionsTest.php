<?php

declare(strict_types=1);

use App\Domain\Aircraft\Actions\SyncSimContent;
use App\Domain\Missions\Models\Mission;
use App\Models\User;

/**
 * Этап 6: миссия от генератора — черновик игрока, проверенный той же JSON Schema.
 */
beforeEach(function (): void {
    app(SyncSimContent::class)->handle();
});

function generatedDefinition(): array
{
    $definition = json_decode((string) file_get_contents(resource_path('sim/missions/milk-run.json')), true);
    unset($definition['$schema']);
    $definition['title'] = ['ru' => 'Сгенерированный вылет', 'en' => 'Generated sortie'];
    $definition['seed'] = 777;

    return $definition;
}

it('stores a generated mission as the player draft, idempotently, outside the catalog', function (): void {
    $user = User::factory()->withPilotProfile()->create();

    $slug = $this->actingAs($user)->postJson('/api/missions/generated', ['definition' => generatedDefinition()])->assertCreated()->json('data.slug');
    $again = $this->actingAs($user)->postJson('/api/missions/generated', ['definition' => generatedDefinition()])->assertCreated()->json('data.slug');

    expect($slug)->toStartWith('gen-')
        ->and($again)->toBe($slug)
        ->and(Mission::query()->where('slug', $slug)->count())->toBe(1)
        ->and(Mission::query()->where('slug', $slug)->value('generated_by'))->toBe($user->id);

    $this->actingAs($user)->getJson('/api/missions')->assertOk()->assertJsonMissing(['slug' => $slug]);

    // Экипаж на сгенерированной миссии — только у автора.
    $this->actingAs($user)->postJson('/api/crews', ['mission' => $slug, 'visibility' => 'private', 'max_players' => 8])->assertCreated()
        ->assertJsonPath('data.mission.slug', $slug);
    $this->actingAs(User::factory()->withPilotProfile()->create())->postJson('/api/crews', ['mission' => $slug, 'visibility' => 'private', 'max_players' => 8])->assertNotFound();
});

it('rejects a generated mission that breaks the schema', function (): void {
    $definition = generatedDefinition();
    $definition['waypoints'] = [];

    $this->actingAs(User::factory()->create())->postJson('/api/missions/generated', ['definition' => $definition])->assertUnprocessable();
});
