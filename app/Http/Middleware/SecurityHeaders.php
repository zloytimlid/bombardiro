<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Vite;
use Symfony\Component\HttpFoundation\Response;

/**
 * Строгие заголовки и CSP (раздел 13, «Безопасность»). Источники — только свой домен:
 * игровой WebSocket идёт на тот же хост (nginx → Reverb), воркер симядра — same-origin (в dev — blob).
 * В разработке добавляется сервер Vite; в продакшене — HSTS и отправка ошибок в Sentry (если задан DSN).
 */
final class SecurityHeaders
{
    public function handle(Request $request, Closure $next): Response
    {
        // Одноразовый nonce для встроенного скрипта темы и тегов Vite (@vite проставляет его сам).
        $nonce = Vite::useCspNonce();
        $response = $next($request);

        // Админка Filament и Pulse подключают свои скрипты и стили — им своя политика пакета.
        if ($request->is('admin', 'admin/*', 'pulse', 'pulse/*', 'horizon', 'horizon/*')) {
            return $this->common($response, $request);
        }

        $dev = app()->isLocal() ? ' http://localhost:5173 ws://localhost:5173' : '';
        // В разработке воркер симядра — blob-обёртка над модулем с сервера Vite (другой origin).
        $devScript = app()->isLocal() ? ' http://localhost:5173' : '';
        $host = $request->getHttpHost();
        $ws = $request->isSecure() ? "wss://{$host}" : "ws://{$host}";
        $sentry = $this->sentryOrigin();

        $policy = implode('; ', [
            "default-src 'self'",
            "script-src 'self' 'nonce-{$nonce}'{$dev}",
            "style-src 'self' 'unsafe-inline'{$dev}",
            "img-src 'self' data: blob:{$dev}",
            "font-src 'self' data:{$dev}",
            "connect-src 'self' {$ws}{$dev}{$sentry}",
            // Импорты модульного воркера проверяются по worker-src (назначение запроса «worker»).
            "worker-src 'self' blob:{$devScript}",
            // Музыка меню в разработке отдаётся сервером Vite (другой origin), в сборке — со своего домена.
            "media-src 'self' blob:{$devScript}",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
            "frame-ancestors 'none'",
        ]);

        $response->headers->set('Content-Security-Policy', $policy);

        return $this->common($response, $request);
    }

    private function common(Response $response, Request $request): Response
    {
        $response->headers->set('X-Content-Type-Options', 'nosniff');
        $response->headers->set('X-Frame-Options', 'DENY');
        $response->headers->set('Referrer-Policy', 'strict-origin-when-cross-origin');
        // Микрофон — для голосового СПУ (этап 6), только свой домен.
        $response->headers->set('Permissions-Policy', 'camera=(), geolocation=(), payment=(), usb=(), microphone=(self), gamepad=(self)');
        $response->headers->set('Cross-Origin-Opener-Policy', 'same-origin');

        if (app()->isProduction() && $request->isSecure()) {
            $response->headers->set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        }

        return $response;
    }

    private function sentryOrigin(): string
    {
        $dsn = config('sentry.dsn');

        if (! is_string($dsn) || $dsn === '') {
            return '';
        }

        $parts = parse_url($dsn);

        return isset($parts['scheme'], $parts['host']) ? " {$parts['scheme']}://{$parts['host']}" : '';
    }
}
