<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

final class DashboardController extends Controller
{
    public function __invoke(Request $request): Response
    {
        /** @var User $user */
        $user = $request->user();
        $profile = $user->pilotProfile;

        return Inertia::render('Dashboard', [
            'profile' => $profile === null ? null : [
                'callsign' => $profile->callsign,
                'rank' => $profile->rank,
                'missionsTotal' => $profile->missions_total,
                'flightSecondsTotal' => $profile->flight_seconds_total,
            ],
        ]);
    }
}
