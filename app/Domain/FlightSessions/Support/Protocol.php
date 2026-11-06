<?php

declare(strict_types=1);

namespace App\Domain\FlightSessions\Support;

/**
 * Параметры сетевого протокола (раздел 9, docs/protocol.md). Версия совпадает с
 * PROTOCOL_VERSION в resources/js/game/net/schemas.ts (проверяется тестом).
 */
final class Protocol
{
    public const int VERSION = 1;

    /** Хост не отметился дольше — считается пропавшим при сообщении о потере (раздел 9.3: 3 с). */
    public const float HOST_SILENCE_SECONDS = 1.0;

    /** Сообщение о потере чуть раньше порога сервер дожидается сам, не дольше (с): без повторного запроса. */
    public const float HOST_LOST_WAIT_SECONDS = 1.2;

    /** Кандидат в хосты должен отметиться не позже. */
    public const int CANDIDATE_SEEN_SECONDS = 6;

    /** Льготный срок нового хоста: загрузка снапшота и восстановление мира. */
    public const float NEW_HOST_GRACE_SECONDS = 5.0;

    /** Снапшот для миграции хранится в Redis 10 минут. */
    public const int SNAPSHOT_TTL_SECONDS = 600;

    public static function snapshotKey(string $session): string
    {
        return "session:{$session}:snapshot";
    }

    public static function hostSeenKey(string $session): string
    {
        return "session:{$session}:host_seen";
    }

    /**
     * Когда запрос пришёл на сервер (с), а не когда PHP до него дошёл: nginx передаёт `$msec` как
     * fastcgi_param REQUEST_START (клиент его не подделает). Пульс хоста и сообщение о потере сравниваются
     * по этому времени — очередь PHP-FPM под нагрузкой не превращается в мнимую тишину хоста.
     * Без nginx (тесты, artisan) или с неправдоподобным значением — текущее время.
     */
    public static function arrivedAt(): float
    {
        $now = now()->getPreciseTimestamp(3) / 1000;
        $raw = request()->server('REQUEST_START');

        if (! is_string($raw) || ! is_numeric($raw)) {
            return $now;
        }

        $at = (float) $raw;

        return $at <= $now + 1 && $at >= $now - 120 ? min($at, $now) : $now;
    }
}
