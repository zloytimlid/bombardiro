<?php

declare(strict_types=1);

namespace Database\Factories;

use App\Domain\Crews\Actions\InviteCode;
use App\Domain\Crews\Enums\CrewStatus;
use App\Domain\Crews\Enums\CrewVisibility;
use App\Domain\Crews\Models\Crew;
use App\Domain\Missions\Models\Mission;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Crew>
 */
class CrewFactory extends Factory
{
    protected $model = Crew::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'name' => 'Crew '.fake()->unique()->numberBetween(1, 99999),
            'owner_id' => User::factory(),
            'invite_code' => InviteCode::generate(),
            'visibility' => CrewVisibility::Private,
            'max_players' => 8,
            'status' => CrewStatus::Lobby,
            'mission_id' => Mission::factory(),
            'difficulty' => 'training',
            'host_user_id' => null,
        ];
    }
}
