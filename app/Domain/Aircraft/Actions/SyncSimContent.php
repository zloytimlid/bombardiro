<?php

declare(strict_types=1);

namespace App\Domain\Aircraft\Actions;

use App\Domain\Aircraft\Models\AircraftType;
use App\Domain\Aircraft\Models\Airframe;
use App\Domain\Missions\Models\Theatre;
use Illuminate\Support\Facades\DB;
use JsonException;
use RuntimeException;

/**
 * Загружает контент симуляции из resources/sim (единственный источник) в БД.
 * Схема файлов проверяется в Vitest (zod → resources/sim/schemas/*.schema.json).
 */
final class SyncSimContent
{
    /**
     * @throws JsonException
     */
    public function handle(): void
    {
        DB::transaction(function (): void {
            $theatre = $this->readJson('sim/theatres/corsica.json');
            $definition = $theatre;
            unset($definition['name'], $definition['bounds'], $definition['terrain_manifest_url'], $definition['todo']);

            Theatre::query()->updateOrCreate(['slug' => $theatre['slug']], [
                'name' => $theatre['name'],
                'origin_lat' => $theatre['origin_lat'],
                'origin_lon' => $theatre['origin_lon'],
                'bounds' => $theatre['bounds'],
                'terrain_manifest_url' => $theatre['terrain_manifest_url'],
                'definition' => $definition,
                'placeholder' => (bool) $theatre['placeholder'],
            ]);

            $config = $this->readJson('sim/aircraft/b25j.json');
            /** @var array{serial: string, name: string} $airframe */
            $airframe = $config['airframe'];

            $type = AircraftType::query()->updateOrCreate(['slug' => $config['id']], [
                'name' => 'North American B-25J Mitchell',
                'config' => $config,
                'config_version' => (int) $config['config_version'],
            ]);

            Airframe::query()->updateOrCreate(['serial' => $airframe['serial']], [
                'aircraft_type_id' => $type->id,
                'name' => $airframe['name'],
                'livery' => '340bg-olive-drab',
            ]);
        });
    }

    /**
     * @return array<string, mixed>
     *
     * @throws JsonException
     */
    private function readJson(string $path): array
    {
        $contents = file_get_contents(resource_path($path));

        if ($contents === false) {
            throw new RuntimeException("Cannot read {$path}");
        }

        /** @var array<string, mixed> */
        return json_decode($contents, true, flags: JSON_THROW_ON_ERROR);
    }
}
