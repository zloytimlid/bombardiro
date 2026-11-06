<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Domain\Aircraft\Enums\Station;
use App\Domain\Crews\Actions\CrewActions;
use App\Domain\Crews\Enums\CrewVisibility;
use App\Domain\Crews\Models\Crew;
use App\Domain\Crews\Support\CrewRoster;
use App\Domain\FlightSessions\Actions\FlightSessionService;
use App\Domain\Missions\Models\Mission;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * JSON API лобби (раздел 11): /api/crews/*.
 */
final class CrewApiController extends Controller
{
    public function __construct(private readonly CrewActions $crews) {}

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'mission' => ['required', 'string', 'exists:missions,slug'],
            'visibility' => ['required', Rule::enum(CrewVisibility::class)],
            'max_players' => ['required', 'integer', 'between:1,8'],
            'name' => ['nullable', 'string', 'max:64'],
        ]);

        $mission = Mission::availableTo($data['mission'], $this->authUser()->id);

        abort_if($mission === null, 404);

        $crew = $this->crews->create($this->authUser(), $mission, CrewVisibility::from($data['visibility']), (int) $data['max_players'], $data['name'] ?? null);

        return response()->json(['data' => CrewRoster::of($crew)], 201);
    }

    public function join(Request $request): JsonResponse
    {
        $data = $request->validate(['invite_code' => ['required', 'string', 'size:8']]);
        $crew = $this->crews->join($this->authUser(), $data['invite_code']);

        return response()->json(['data' => CrewRoster::of($crew)]);
    }

    public function claimSeat(Crew $crew, Station $seat): JsonResponse
    {
        $this->crews->claimSeat($crew, $this->authUser(), $seat);

        return response()->json(['data' => CrewRoster::of($crew->refresh())]);
    }

    public function releaseSeat(Crew $crew, Station $seat): JsonResponse
    {
        $this->crews->releaseSeat($crew, $this->authUser(), $seat);

        return response()->json(['data' => CrewRoster::of($crew->refresh())]);
    }

    public function ready(Request $request, Crew $crew): JsonResponse
    {
        $data = $request->validate(['ready' => ['required', 'boolean']]);

        $this->crews->setReady($crew, $this->authUser(), (bool) $data['ready']);

        return response()->json(['data' => CrewRoster::of($crew->refresh())]);
    }

    public function configure(Request $request, Crew $crew): JsonResponse
    {
        $data = $request->validate([
            'difficulty' => ['sometimes', Rule::in(['training', 'historical'])],
            'host_user_id' => ['sometimes', 'nullable', 'integer'],
        ]);

        $this->crews->configure($crew, $this->authUser(), $data);

        return response()->json(['data' => CrewRoster::of($crew->refresh())]);
    }

    public function heartbeat(Request $request, Crew $crew): JsonResponse
    {
        $data = $request->validate(['rtt_ms' => ['nullable', 'integer', 'between:0,10000']]);

        abort_if($this->crews->heartbeat($crew, $this->authUser(), $data['rtt_ms'] ?? null) === null, 403);

        return response()->json(['ok' => true, 'at' => now()->getTimestampMs()]);
    }

    public function leave(Crew $crew): JsonResponse
    {
        $this->crews->leave($crew, $this->authUser());

        return response()->json(['ok' => true]);
    }

    public function start(Crew $crew, FlightSessionService $sessions): JsonResponse
    {
        $session = $sessions->start($crew, $this->authUser());

        return response()->json(['data' => ['session' => $session->ulid, 'host_user_id' => $session->host_user_id]], 201);
    }
}
