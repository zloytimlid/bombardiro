<?php

declare(strict_types=1);

namespace App\Domain\FlightSessions\Enums;

/** Состояние вылета (раздел 10). */
enum FlightSessionStatus: string
{
    case Briefing = 'briefing';
    case Active = 'active';
    case Finished = 'finished';
    case Aborted = 'aborted';

    /**
     * @return list<string>
     */
    public static function values(): array
    {
        return array_column(self::cases(), 'value');
    }

    public function isOpen(): bool
    {
        return $this === self::Briefing || $this === self::Active;
    }
}
