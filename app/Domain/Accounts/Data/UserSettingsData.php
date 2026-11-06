<?php

declare(strict_types=1);

namespace App\Domain\Accounts\Data;

use Spatie\LaravelData\Attributes\Validation\ArrayType;
use Spatie\LaravelData\Attributes\Validation\Between;
use Spatie\LaravelData\Attributes\Validation\In;
use Spatie\LaravelData\Attributes\Validation\Max;
use Spatie\LaravelData\Data;
use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/**
 * Настройки игрока (раздел 10: users.settings JSONB; раздел 12: управление, графика, звук, доступность).
 * Одна схема: laravel-data на сервере → TypeScript (resources/js/types/generated) на клиенте.
 * Переназначение клавиш: действие → до двух кодов клавиш (KeyboardEvent.code) или кнопок геймпада.
 */
#[TypeScript]
final class UserSettingsData extends Data
{
    /**
     * Списки — nullable: laravel-data иначе требует непустой массив (required).
     *
     * @param  array<string, list<string>>|null  $bindings
     * @param  array<string, array{index: int, invert: bool}>|null  $gamepad_axes
     * @param  array<string, float>|null  $volumes
     */
    public function __construct(
        #[ArrayType, Max(80)]
        public ?array $bindings = [],
        #[Between(0.1, 5)]
        public float $mouse_sensitivity = 1.0,
        public bool $invert_y = false,
        #[ArrayType, Max(16)]
        public ?array $gamepad_axes = [],
        #[Between(0, 0.5)]
        public float $gamepad_deadzone = 0.08,
        #[Between(1, 3)]
        public float $gamepad_curve = 1.6,
        #[In(['low', 'medium', 'high'])]
        public string $graphics = 'medium',
        #[Between(0.5, 1.5)]
        public float $render_scale = 1.0,
        public bool $shadows = true,
        #[ArrayType, Max(5)]
        public ?array $volumes = [],
        public bool $subtitles = true,
        public bool $camera_shake = true,
        #[Between(80, 150)]
        public int $ui_scale = 100,
        #[In(['hold', 'toggle'])]
        public string $long_actions = 'hold',
        #[In(['imperial', 'metric'])]
        public string $units = 'imperial',
        /** Рендер (этап 6): WebGPU — если поддерживается браузером, иначе WebGL 2. */
        #[In(['webgl', 'webgpu'])]
        public string $renderer = 'webgl',
    ) {}

    /**
     * Сохранённые настройки поверх значений по умолчанию (старые записи без новых полей — валидны).
     * Не «from…»: такие статические методы laravel-data считает магическими конструкторами (рекурсия с from()).
     *
     * @param  array<string, mixed>  $stored
     */
    public static function withDefaults(array $stored): self
    {
        return self::from([...(new self)->toArray(), ...$stored]);
    }
}
