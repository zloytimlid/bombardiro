<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Domain\Crews\Models\Crew;
use App\Domain\Flights\Actions\FlightService;
use App\Domain\Flights\Models\Flight;
use App\Domain\FlightSessions\Models\FlightSession;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Звено до 4 экипажей (этап 6): создать, войти по коду, выйти, старт ведущим, состав.
 */
final class FlightApiController extends Controller
{
    public function __construct(private readonly FlightService $flights) {}

    public function store(Crew $crew): JsonResponse
    {
        $flight = $this->flights->create($crew, $this->authUser());

        return response()->json(['data' => $this->describe($flight->refresh())], 201);
    }

    public function join(Request $request, Crew $crew): JsonResponse
    {
        $data = $request->validate(['invite_code' => ['required', 'string', 'size:8']]);
        $flight = $this->flights->join($crew, $this->authUser(), $data['invite_code']);

        return response()->json(['data' => $this->describe($flight->refresh())]);
    }

    public function leave(Crew $crew): JsonResponse
    {
        $this->flights->leave($crew, $this->authUser());

        return response()->json(['ok' => true]);
    }

    public function show(Flight $flight): JsonResponse
    {
        abort_unless(Crew::query()->where('flight_id', $flight->id)->whereHas('members', fn ($q) => $q->where('user_id', $this->authUser()->id))->exists(), 403);

        return response()->json(['data' => $this->describe($flight)]);
    }

    public function start(Flight $flight): JsonResponse
    {
        $sessions = $this->flights->start($flight, $this->authUser());

        return response()->json(['data' => ['sessions' => array_map(fn (FlightSession $s): array => ['crew' => $s->crew->ulid, 'session' => $s->ulid, 'slot' => $s->flight_slot], $sessions)]], 201);
    }

    /**
     * @return array{ulid: string, invite_code: string, status: string, mission: string, leader: string, crews: list<array{crew: string, name: string, slot: int, ready: bool}>}
     */
    private function describe(Flight $flight): array
    {
        $flight->loadMissing(['crews.members', 'leader', 'mission']);

        return [
            'ulid' => $flight->ulid,
            'invite_code' => $flight->invite_code,
            'status' => $flight->status,
            'mission' => $flight->mission->slug,
            'leader' => $flight->leader->ulid,
            'crews' => array_values($flight->crews->map(fn (Crew $c): array => [
                'crew' => $c->ulid,
                'name' => $c->name,
                'slot' => (int) $c->flight_slot,
                'ready' => $c->members->whereNotNull('seat')->isNotEmpty() && $c->members->whereNotNull('seat')->every(fn ($m): bool => (bool) $m->is_ready),
            ])->all()),
        ];
    }
}
