<?php

declare(strict_types=1);

namespace App\Domain\Missions\Enums;

/**
 * Сложность миссии в каталоге (поле difficulty, раздел 10).
 */
enum MissionDifficulty: string
{
    case Training = 'training';
    case Normal = 'normal';
    case Hard = 'hard';

    /**
     * @return list<string>
     */
    public static function values(): array
    {
        return array_column(self::cases(), 'value');
    }
}
