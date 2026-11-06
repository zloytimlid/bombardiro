<?php

use App\Domain\Aircraft\Actions\SyncSimContent;
use App\Domain\Aircraft\Enums\Station;
use App\Domain\Aircraft\Models\AircraftType;
use App\Domain\Aircraft\Models\Airframe;
use App\Domain\Missions\Models\Mission;
use App\Domain\Missions\Models\Theatre;
use App\Models\User;
use Inertia\Testing\AssertableInertia as Assert;

beforeEach(function (): void {
    app(SyncSimContent::class)->handle();
});

it('loads the theatre, the B-25J config, airframe 43-4064 and the missions from resources/sim', function (): void {
    $type = AircraftType::query()->where('slug', 'b25j')->firstOrFail();
    $airframe = Airframe::query()->where('serial', '43-4064')->firstOrFail();
    $theatre = Theatre::query()->where('slug', 'corsica')->firstOrFail();
    $mission = Mission::latestPublished('milk-run');

    expect($type->config['geometry']['wingspan_m']['value'])->toBe(20.6)
        ->and($type->config_version)->toBe(1)
        ->and($airframe->aircraftType->is($type))->toBeTrue()
        ->and($airframe->name)->toBe('Lil Critter from the Moon')
        ->and($theatre->placeholder)->toBeTrue()
        ->and($theatre->definition['runways'][0]['id'])->toBe('36')
        ->and($theatre->definition['mainland_coast_x_m'])->toBe(112000)
        ->and($theatre->localizedName('ru'))->toBe('Корсика, Алезани')
        ->and($mission)->not->toBeNull()
        ->and($mission?->theatre->is($theatre))->toBeTrue()
        ->and($mission?->placeholder)->toBeTrue();
});

it('is idempotent', function (): void {
    app(SyncSimContent::class)->handle();

    expect(AircraftType::query()->count())->toBe(1)
        ->and(Airframe::query()->count())->toBe(1)
        ->and(Theatre::query()->count())->toBe(2)
        ->and(Mission::query()->where('slug', 'milk-run')->count())->toBe(1)
        ->and(Mission::query()->whereIn('slug', ['avignon', 'brenner'])->count())->toBe(2);
});

it('renders a training for every one of the 8 stations', function (Station $station): void {
    $user = User::factory()->withPilotProfile()->create();

    $this->actingAs($user)
        ->get(route('training.show', $station->value))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('training/Station')
            ->where('station', $station->value)
            ->where('difficulty', 'training')
            ->where('aircraftConfig.id', 'b25j')
            ->where('mission.id', 'milk-run')
            ->where('theatre.definition.slug', 'corsica')
            ->has('seed'));
})->with(Station::cases());

it('passes the historical difficulty through', function (): void {
    $this->actingAs(User::factory()->create())
        ->get(route('training.show', ['station' => 'tail_gunner', 'difficulty' => 'historical']))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->where('difficulty', 'historical'));
});

it('returns 404 for unknown stations and redirects guests', function (): void {
    $this->get(route('training.show', 'pilot'))->assertRedirect(route('login'));
    $this->actingAs(User::factory()->create())->get('/training/flight-engineer')->assertNotFound();
});
