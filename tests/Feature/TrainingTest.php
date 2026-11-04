<?php

use App\Domain\Aircraft\Actions\SyncSimContent;
use App\Domain\Aircraft\Models\AircraftType;
use App\Domain\Aircraft\Models\Airframe;
use App\Domain\Missions\Models\Theatre;
use App\Models\User;
use Inertia\Testing\AssertableInertia as Assert;

beforeEach(function (): void {
    app(SyncSimContent::class)->handle();
});

it('loads the theatre, the B-25J config and airframe 43-4064 from resources/sim', function (): void {
    $type = AircraftType::query()->where('slug', 'b25j')->firstOrFail();
    $airframe = Airframe::query()->where('serial', '43-4064')->firstOrFail();
    $theatre = Theatre::query()->where('slug', 'corsica')->firstOrFail();

    expect($type->config['geometry']['wingspan_m']['value'])->toBe(20.6)
        ->and($type->config_version)->toBe(1)
        ->and($airframe->aircraftType->is($type))->toBeTrue()
        ->and($airframe->name)->toBe('Lil Critter from the Moon')
        ->and($theatre->placeholder)->toBeTrue()
        ->and($theatre->definition['runways'][0]['id'])->toBe('36')
        ->and($theatre->localizedName('ru'))->toBe('Корсика, Алезани');
});

it('is idempotent', function (): void {
    app(SyncSimContent::class)->handle();

    expect(AircraftType::query()->count())->toBe(1)
        ->and(Airframe::query()->count())->toBe(1)
        ->and(Theatre::query()->count())->toBe(1);
});

it('renders the pilot training with aircraft config and theatre', function (): void {
    $user = User::factory()->withPilotProfile()->create();

    $this->actingAs($user)
        ->get(route('training.show', 'pilot'))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('training/Station')
            ->where('station', 'pilot')
            ->where('available', true)
            ->where('difficulty', 'training')
            ->where('aircraftConfig.id', 'b25j')
            ->where('theatre.definition.slug', 'corsica')
            ->has('seed'));
});

it('marks stations without a client yet as unavailable', function (): void {
    $user = User::factory()->create();

    $this->actingAs($user)
        ->get(route('training.show', ['station' => 'tail_gunner', 'difficulty' => 'historical']))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->where('available', false)->where('difficulty', 'historical'));
});

it('returns 404 for unknown stations and redirects guests', function (): void {
    $this->get(route('training.show', 'pilot'))->assertRedirect(route('login'));
    $this->actingAs(User::factory()->create())->get('/training/flight-engineer')->assertNotFound();
});
