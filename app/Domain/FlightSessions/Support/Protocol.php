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
}
