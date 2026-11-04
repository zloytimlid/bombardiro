<?php

declare(strict_types=1);

namespace Database\Factories;

use App\Domain\Aircraft\Models\AircraftType;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<AircraftType>
 */
class AircraftTypeFactory extends Factory
{
    protected $model = AircraftType::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        /** @var array<string, mixed> $config */
        $config = json_decode((string) file_get_contents(resource_path('sim/aircraft/b25j.json')), true, flags: JSON_THROW_ON_ERROR);

        return [
            'slug' => fake()->unique()->lexify('type-????'),
            'name' => 'North American B-25J Mitchell',
            'config' => $config,
            'config_version' => (int) $config['config_version'],
        ];
    }
}
