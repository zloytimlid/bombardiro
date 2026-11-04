<?php

declare(strict_types=1);

namespace Database\Factories;

use App\Domain\Progression\Models\PilotProfile;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<PilotProfile>
 */
class PilotProfileFactory extends Factory
{
    protected $model = PilotProfile::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'callsign' => fake()->unique()->regexify('[A-Z][a-z]{3,8}[0-9]{2}'),
            'rank' => 'second_lieutenant',
            'preferred_seat' => null,
        ];
    }
}
