<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Laravel\Pulse\Facades\Pulse;

/**
 * Клиентская телеметрия (раздел 13): раз в 30 с — средний FPS по пресету графики и RTT в кооперативе.
 * Хранится только агрегатом Pulse, без привязки к игроку.
 */
final class TelemetryController extends Controller
{
    public function __invoke(Request $request): JsonResponse
    {
        $data = $request->validate([
            'fps' => ['required', 'numeric', 'between:0,500'],
            'preset' => ['required', Rule::in(['low', 'medium', 'high'])],
            'rtt_ms' => ['nullable', 'integer', 'between:0,10000'],
            'mode' => ['required', Rule::in(['solo', 'training', 'crew'])],
        ]);

        Pulse::record('client_fps', $data['preset'], (int) round((float) $data['fps']))->avg()->min()->count();

        if (isset($data['rtt_ms'])) {
            Pulse::record('client_rtt', $data['mode'], (int) $data['rtt_ms'])->avg()->max()->count();
        }

        return response()->json(['ok' => true], 202);
    }
}
