<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Domain\FlightSessions\Models\FlightSession;
use App\Domain\FlightSessions\Models\FlightSessionReplay;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Повтор вылета (этап 6): скачать (участники экипажа) и закрепить, чтобы не удалился через 30 дней (хост или админ).
 */
final class ReplayController extends Controller
{
    public function show(FlightSession $session): StreamedResponse
    {
        abort_unless($session->crew->hasMember($this->authUser()) || $session->isParticipant($this->authUser()), 403);

        $replay = FlightSessionReplay::query()->where('flight_session_id', $session->id)->first();

        abort_if($replay === null || ! Storage::exists($replay->storage_path), 404);

        return Storage::download($replay->storage_path, "replay-{$session->ulid}.json.gz", ['Content-Type' => 'application/gzip']);
    }

    public function pin(FlightSession $session): JsonResponse
    {
        $user = $this->authUser();

        abort_unless($user->isAdmin() || $session->host_user_id === $user->id || $session->crew->owner_id === $user->id, 403);

        $replay = FlightSessionReplay::query()->where('flight_session_id', $session->id)->firstOrFail();

        $replay->update(['pinned' => ! $replay->pinned]);

        return response()->json(['pinned' => $replay->pinned]);
    }
}
