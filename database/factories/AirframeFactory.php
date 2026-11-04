<?php

declare(strict_types=1);

namespace Database\Factories;

use App\Domain\Aircraft\Models\AircraftType;
use App\Domain\Aircraft\Models\Airframe;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Airframe>
 */
class AirframeFactory extends Factory
{
    protected $model = Airframe::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'aircraft_type_id' => AircraftType::factory(),
            'serial' => fake()->unique()->numerify('43-####'),
            'name' => fake()->words(3, true),
            'livery' => null,
            'state' => [],
        ];
    }
}
