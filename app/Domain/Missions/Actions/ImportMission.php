<?php

declare(strict_types=1);

namespace App\Domain\Missions\Actions;

use App\Domain\Missions\Data\MissionMetaData;
use App\Domain\Missions\Models\Mission;
use App\Domain\Missions\Models\Theatre;
use App\Domain\Missions\Support\MissionSchema;
use Illuminate\Validation\ValidationException;
use JsonException;

/**
 * Загрузка миссии: JSON Schema → laravel-data → версия. Если содержимое опубликованной
 * миссии изменилось, создаётся новая версия; старые остаются для вылетов, которые на них ссылаются.
 */
final readonly class ImportMission
{
    public function __construct(private MissionSchema $schema) {}

    /**
     * @param  array<string, mixed>  $definition
     *
     * @throws ValidationException
     * @throws JsonException
     */
    public function handle(array $definition, bool $publish = true): Mission
    {
        unset($definition['$schema']);

        $errors = $this->schema->errors($definition);

        if ($errors !== []) {
            throw ValidationException::withMessages(['definition' => $errors]);
        }

        $meta = MissionMetaData::validateAndCreate($definition);
        $theatre = Theatre::query()->where('slug', $meta->theatre)->first();

        if ($theatre === null) {
            throw ValidationException::withMessages(['definition' => ["theatre: unknown theatre {$meta->theatre}"]]);
        }

        $latest = Mission::query()->where('slug', $meta->id)->orderByDesc('version')->first();

        if ($latest !== null && $this->same($latest->definition, $definition)) {
            return $latest;
        }

        $attributes = [
            'title' => $meta->title,
            'theatre_id' => $theatre->id,
            'historical_date' => $meta->historical_date,
            'difficulty' => $meta->difficultyEnum(),
            'is_published' => $publish,
            'placeholder' => $meta->placeholder,
            'sources' => $meta->sources,
        ];

        // Черновик правится на месте, опубликованная — только новой версией.
        if ($latest !== null && ! $latest->is_published) {
            $latest->fill([...$attributes, 'definition' => $definition])->save();

            return $latest;
        }

        $version = max($meta->version, ($latest->version ?? 0) + 1);
        $definition['version'] = $version;

        return Mission::query()->create([...$attributes, 'slug' => $meta->id, 'version' => $version, 'definition' => $definition]);
    }

    /**
     * @param  array<string, mixed>  $a
     * @param  array<string, mixed>  $b
     */
    private function same(array $a, array $b): bool
    {
        unset($a['version'], $b['version']);

        return $this->canonical($a) === $this->canonical($b);
    }

    private function canonical(mixed $value): string
    {
        if (is_array($value)) {
            if (! array_is_list($value)) {
                ksort($value);
            }

            return '{'.implode(',', array_map(fn ($k, $v): string => $k.':'.$this->canonical($v), array_keys($value), $value)).'}';
        }

        // jsonb возвращает 1.0 как 1 — числа сравниваем без дробной нулевой части.
        return json_encode($value, JSON_THROW_ON_ERROR);
    }
}
