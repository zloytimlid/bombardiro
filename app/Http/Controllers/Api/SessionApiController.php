<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Domain\FlightSessions\Actions\FlightSessionService;
use App\Domain\FlightSessions\Data\Net\NetEventBatchData;
use App\Domain\FlightSessions\Data\Net\NetFinishData;
use App\Domain\FlightSessions\Data\Net\NetHeartbeatData;
use App\Domain\FlightSessions\Data\Net\NetSnapshotData;
use App\Domain\FlightSessions\Models\FlightSession;
use App\Domain\FlightSessions\Support\Protocol;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * JSON API вылета (раздел 11): /api/sessions/{s}/*. Вход проверяет laravel-data (раздел 13).
 */
final class SessionApiController extends Controller
{
    public function __construct(private readonly FlightSessionService $sessions) {}

    public function bootstrap(FlightSession $session): JsonResponse
    {
        return response()->json(['data' => $this->sessions->bootstrap($session, $this->authUser())]);
    }

    public function heartbeat(Request $request, FlightSession $session): JsonResponse
    {
        $data = NetHeartbeatData::validateAndCreate($request->all());

        $this->sessions->heartbeat($session, $this->authUser(), $data->rtt_ms);

        return response()->json(['ok' => true, 'host_user_id' => $session->refresh()->host_user_id, 'status' => $session->status->value, 'at' => now()->getTimestampMs()]);
    }

    public function events(Request $request, FlightSession $session): JsonResponse
    {
        $batch = NetEventBatchData::validateAndCreate($request->all());

        abort_if($batch->v !== Protocol::VERSION, 409, __('session.error.protocol'));

        $inserted = $this->sessions->appendEvents($session, $this->authUser(), $batch);

        return response()->json(['inserted' => $inserted, 'last_seq' => $session->refresh()->last_seq]);
    }

    public function putSnapshot(Request $request, FlightSession $session): JsonResponse
    {
        $snapshot = NetSnapshotData::validateAndCreate($request->all());

        abort_if($snapshot->v !== Protocol::VERSION, 409, __('session.error.protocol'));

        $this->sessions->putSnapshot($session, $this->authUser(), $snapshot);

        return response()->json(['ok' => true]);
    }

    public function getSnapshot(FlightSession $session): JsonResponse
    {
        $snapshot = $this->sessions->getSnapshot($session, $this->authUser());

        return response()->json(['data' => $snapshot]);
    }

    public function hostLost(FlightSession $session): JsonResponse
    {
        $session = $this->sessions->hostLost($session, $this->authUser());

        return response()->json(['host_user_id' => $session->host_user_id]);
    }

    public function finish(Request $request, FlightSession $session): JsonResponse
    {
        $data = NetFinishData::validateAndCreate($request->all());

        $this->sessions->finish($session, $this->authUser(), $data);

        return response()->json(['ok' => true], 202);
    }

    public function debrief(FlightSession $session): JsonResponse
    {
        abort_unless($session->crew->hasMember($this->authUser()) || $session->isParticipant($this->authUser()), 403);

        $debrief = $session->debrief;
        $ready = is_array($debrief) && array_key_exists('score', $debrief);

        // Последнее место игрока в вылете — его карточка метрик открывается первой.
        $seat = $session->participants()->where('user_id', $this->authUser()->id)->latest('id')->value('seat');

        return response()->json([
            'ready' => $ready,
            'data' => $ready ? $debrief : null,
            'score' => $session->score,
            'verified' => $session->verified,
            'seat' => $seat,
            'crew' => $session->crew->ulid,
        ]);
    }
}
