<?php

declare(strict_types=1);

namespace Database\Factories;

use App\Domain\Missions\Enums\MissionDifficulty;
use App\Domain\Missions\Models\Mission;
use App\Domain\Missions\Models\Theatre;
use Illuminate\Database\Eloquent\Factories\Factory;
use JsonException;

/**
 * @extends Factory<Mission>
 */
class MissionFactory extends Factory
{
    protected $model = Mission::class;

    /**
     * Определение берётся из обучающей миссии — оно гарантированно проходит схему.
     *
     * @return array<string, mixed>
     *
     * @throws JsonException
     */
    public function definition(): array
    {
        $slug = fake()->unique()->slug(2);
        /** @var array<string, mixed> $definition */
        $definition = json_decode((string) file_get_contents(resource_path('sim/missions/milk-run.json')), true, flags: JSON_THROW_ON_ERROR);
        $definition['id'] = $slug;

        return [
            'slug' => $slug,
            'version' => 1,
            'title' => ['ru' => 'Тестовая миссия', 'en' => 'Test mission'],
            'theatre_id' => Theatre::factory(),
            'historical_date' => null,
            'difficulty' => MissionDifficulty::Training,
            'definition' => $definition,
            'is_published' => true,
            'placeholder' => true,
            'sources' => [],
        ];
    }

    public function draft(): static
    {
        return $this->state(['is_published' => false]);
    }
}
