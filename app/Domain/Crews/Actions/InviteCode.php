<?php

declare(strict_types=1);

namespace App\Domain\Crews\Actions;

use App\Domain\Crews\Models\Crew;

/**
 * Код приглашения: 8 символов без похожих (0/O, 1/I), уникален (раздел 10).
 */
final class InviteCode
{
    private const string ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

    public static function generate(): string
    {
        do {
            $code = '';

            for ($i = 0; $i < 8; $i++) {
                $code .= self::ALPHABET[random_int(0, strlen(self::ALPHABET) - 1)];
            }
        } while (Crew::query()->where('invite_code', $code)->exists());

        return $code;
    }

    public static function normalize(string $code): string
    {
        return strtoupper(trim($code));
    }
}
