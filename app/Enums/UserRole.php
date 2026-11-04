<?php

declare(strict_types=1);

namespace App\Enums;

enum UserRole: string
{
    case Player = 'player';
    case Moderator = 'moderator';
    case Admin = 'admin';

    /**
     * @return list<string>
     */
    public static function values(): array
    {
        return array_column(self::cases(), 'value');
    }
}
