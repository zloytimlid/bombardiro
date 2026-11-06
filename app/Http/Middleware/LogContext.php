<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Domain\FlightSessions\Models\FlightSession;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\Response;

/**
 * Структурные логи (раздел 13): каждый запрос вылета несёт flight_session_id, запросы игрока — user_id.
 */
final class LogContext
{
    public function handle(Request $request, Closure $next): Response
    {
        $session = $request->route('session');
        $ulid = $session instanceof FlightSession ? $session->ulid : (is_string($session) ? $session : null);

        Log::withContext(array_filter([
            'flight_session_id' => $ulid,
            'user_id' => $request->user()?->getAuthIdentifier(),
            'request_id' => $request->headers->get('X-Request-Id'),
        ], fn ($v) => $v !== null));

        return $next($request);
    }
}
