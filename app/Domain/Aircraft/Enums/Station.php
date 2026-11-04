<?php

declare(strict_types=1);

namespace App\Domain\Aircraft\Enums;

/**
 * Восемь рабочих мест B-25J (раздел 3 ТЗ). Порядок совпадает с клавишами 1–8.
 */
enum Station: string
{
    case Pilot = 'pilot';
    case Copilot = 'copilot';
    case Bombardier = 'bombardier';
    case Navigator = 'navigator';
    case TopGunner = 'top_gunner';
    case Radio = 'radio';
    case WaistGunner = 'waist_gunner';
    case TailGunner = 'tail_gunner';

    /**
     * @return list<string>
     */
    public static function values(): array
    {
        return array_column(self::cases(), 'value');
    }

    /** Номер станции 1–8 (клавиша переключения). */
    public function number(): int
    {
        return (int) array_search($this, self::cases(), true) + 1;
    }
}
