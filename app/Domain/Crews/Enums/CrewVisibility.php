<?php

declare(strict_types=1);

namespace App\Domain\Crews\Enums;

/** Видимость экипажа: публичный — в списке, приватный — только по коду приглашения. */
enum CrewVisibility: string
{
    case Public = 'public';
    case Private = 'private';

    /**
     * @return list<string>
     */
    public static function values(): array
    {
        return array_column(self::cases(), 'value');
    }
}
