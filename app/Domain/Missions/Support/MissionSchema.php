<?php

declare(strict_types=1);

namespace App\Domain\Missions\Support;

use JsonException;
use Opis\JsonSchema\Errors\ErrorFormatter;
use Opis\JsonSchema\Helper;
use Opis\JsonSchema\Validator;
use RuntimeException;

/**
 * Валидация миссии по resources/sim/schemas/mission.schema.json (раздел 8: «сервер валидирует
 * по JSON Schema и laravel-data»). Схема генерируется из zod в симядре — одна схема на структуру.
 */
final class MissionSchema
{
    private const string SCHEMA_ID = 'https://lil-critter.test/schemas/mission.schema.json';

    private ?Validator $validator = null;

    /**
     * @param  array<string, mixed>  $definition
     * @return list<string> Ошибки в виде «путь: сообщение»; пустой список — миссия валидна.
     *
     * @throws JsonException
     */
    public function errors(array $definition): array
    {
        $result = $this->validator()->validate(Helper::toJSON($definition), self::SCHEMA_ID);

        if ($result->isValid()) {
            return [];
        }

        $error = $result->error();

        if ($error === null) {
            return ['schema: invalid'];
        }

        $messages = [];

        foreach ((new ErrorFormatter)->format($error) as $path => $list) {
            foreach ((array) $list as $message) {
                $messages[] = "{$path}: {$message}";
            }
        }

        return $messages;
    }

    /**
     * @throws JsonException
     */
    private function validator(): Validator
    {
        if ($this->validator !== null) {
            return $this->validator;
        }

        $contents = file_get_contents(resource_path('sim/schemas/mission.schema.json'));

        if ($contents === false) {
            throw new RuntimeException('Cannot read mission.schema.json');
        }

        $validator = new Validator;
        $validator->resolver()?->registerRaw(json_decode($contents, false, flags: JSON_THROW_ON_ERROR), self::SCHEMA_ID);
        $validator->setMaxErrors(20);

        return $this->validator = $validator;
    }
}
