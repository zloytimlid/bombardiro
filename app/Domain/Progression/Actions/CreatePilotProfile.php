<?php

declare(strict_types=1);

namespace App\Domain\Progression\Actions;

use App\Domain\Progression\Models\PilotProfile;
use App\Models\User;

final class CreatePilotProfile
{
    public function handle(User $user, string $callsign): PilotProfile
    {
        return PilotProfile::query()->create([
            'user_id' => $user->id,
            'callsign' => $callsign,
        ]);
    }
}
