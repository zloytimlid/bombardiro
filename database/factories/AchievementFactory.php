<?php

declare(strict_types=1);

namespace Database\Factories;

use App\Domain\Progression\Models\Achievement;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Achievement>
 */
class AchievementFactory extends Factory
{
    protected $model = Achievement::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $slug = fake()->unique()->slug(2);

        return [
            'slug' => $slug,
            'title' => ['ru' => "Достижение {$slug}", 'en' => "Achievement {$slug}"],
            'description' => ['ru' => 'Тестовое достижение', 'en' => 'Test achievement'],
            'criteria' => ['metric' => 'outcome', 'op' => 'eq', 'value' => 'landed'],
            'icon' => 'medal',
            'sort' => 0,
        ];
    }
}
