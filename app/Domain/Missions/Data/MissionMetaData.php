<?php

declare(strict_types=1);

namespace App\Domain\Missions\Data;

use App\Domain\Missions\Enums\MissionDifficulty;
use Spatie\LaravelData\Attributes\Validation\In;
use Spatie\LaravelData\Attributes\Validation\Max;
use Spatie\LaravelData\Attributes\Validation\Min;
use Spatie\LaravelData\Attributes\Validation\Regex;
use Spatie\LaravelData\Data;

/**
 * Поля миссии, которые читает сервер (каталог, версии, театр). Полное содержимое проверяет
 * JSON Schema; этот объект — типизированный вход для домена (раздел 10: «валидация через laravel-data»).
 */
final class MissionMetaData extends Data
{
    /**
     * @param  array{ru: string, en: string}  $title
     * @param  list<array{title: string, url?: string}>  $sources
     */
    public function __construct(
        #[Regex('/^[a-z0-9][a-z0-9-]*$/'), Max(96)]
        public string $id,
        #[Min(1)]
        public int $version,
        public array $title,
        public ?string $historical_date,
        public string $theatre,
        #[In(['training', 'normal', 'hard'])]
        public string $difficulty,
        public bool $placeholder,
        public array $sources,
    ) {}

    public function difficultyEnum(): MissionDifficulty
    {
        return MissionDifficulty::from($this->difficulty);
    }
}
