<?php

declare(strict_types=1);

namespace App\Domain\Crews\Enums;

/** Состояние экипажа (раздел 10): в лобби, в вылете, закрыт. */
enum CrewStatus: string
{
    case Lobby = 'lobby';
    case InSession = 'in_session';
    case Closed = 'closed';

    /**
     * @return list<string>
     */
    public static function values(): array
    {
        return array_column(self::cases(), 'value');
    }
}
