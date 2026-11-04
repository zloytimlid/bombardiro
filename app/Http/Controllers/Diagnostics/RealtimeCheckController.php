<?php

declare(strict_types=1);

namespace App\Http\Controllers\Diagnostics;

use App\Events\Diagnostics\RadioCheck;
use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

final class RealtimeCheckController extends Controller
{
    public function show(): Response
    {
        return Inertia::render('diagnostics/Realtime');
    }

    public function broadcast(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'message' => ['required', 'string', 'max:120'],
        ]);

        /** @var User $user */
        $user = $request->user();
        $callsign = $user->pilotProfile->callsign ?? $user->name;

        RadioCheck::dispatch($callsign, (string) $validated['message'], now()->toIso8601String());

        return response()->json(['status' => 'sent'], 202);
    }
}
