<?php

declare(strict_types=1);

namespace Database\Factories;

use App\Domain\Crews\Models\Crew;
use App\Domain\FlightSessions\Enums\FlightSessionStatus;
use App\Domain\FlightSessions\Models\FlightSession;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<FlightSession>
 */
class FlightSessionFactory extends Factory
{
    protected $model = FlightSession::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $crew = Crew::factory();

        return [
            'crew_id' => $crew,
            'mission_id' => fn (array $attributes) => Crew::query()->whereKey($attributes['crew_id'])->firstOrFail()->mission_id,
            'mission_version' => 1,
            'seed' => fake()->numberBetween(1, 2_000_000_000),
            'difficulty' => 'training',
            'status' => FlightSessionStatus::Active,
            'host_user_id' => fn (array $attributes) => Crew::query()->whereKey($attributes['crew_id'])->firstOrFail()->owner_id,
            'started_at' => now(),
            'flags' => [],
            'last_seq' => 0,
        ];
    }
}
