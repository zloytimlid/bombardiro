<?php

declare(strict_types=1);

namespace Database\Factories;

use App\Domain\Missions\Models\Theatre;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Theatre>
 */
class TheatreFactory extends Factory
{
    protected $model = Theatre::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $slug = fake()->unique()->slug(2);

        return [
            'slug' => $slug,
            'name' => ['ru' => 'Тестовый театр', 'en' => 'Test theatre'],
            'origin_lat' => 42.2,
            'origin_lon' => 9.5,
            'bounds' => ['min_x' => -10000, 'max_x' => 10000, 'min_y' => -10000, 'max_y' => 10000],
            'terrain_manifest_url' => null,
            'definition' => [
                'slug' => $slug,
                'origin_lat' => 42.2,
                'origin_lon' => 9.5,
                'placeholder' => true,
                'seed' => 1,
                'coast_east_m' => 5000,
                'mountains_start_m' => -9000,
                'mountains_peak_m' => 1500,
                'runways' => [['id' => '36', 'x' => 0, 'y' => 0, 'heading' => 0, 'length_m' => 1800, 'width_m' => 45, 'elevation_m' => 15]],
            ],
            'placeholder' => true,
        ];
    }
}
