<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Domain\Missions\Actions\ImportMission;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * POST /api/missions/generated (этап 6): миссию собирает генератор симядра в браузере (одна схема — zod →
 * JSON Schema), сервер проверяет её той же схемой и хранит черновиком игрока. Идентификатор — от содержимого,
 * поэтому повторная отправка той же миссии не плодит копий.
 */
final class GeneratedMissionController extends Controller
{
    public function store(Request $request, ImportMission $import): JsonResponse
    {
        $data = $request->validate(['definition' => ['required', 'array']]);
        /** @var array<string, mixed> $definition */
        $definition = $data['definition'];

        unset($definition['id'], $definition['version']);
        ksort($definition);

        $slug = 'gen-'.substr(hash('sha256', json_encode($definition, JSON_THROW_ON_ERROR)), 0, 12);
        $mission = $import->handle([...$definition, 'id' => $slug, 'version' => 1, 'placeholder' => true], publish: false);

        if ($mission->generated_by === null) {
            $mission->forceFill(['generated_by' => $this->authUser()->id])->save();
        }

        return response()->json(['data' => ['slug' => $mission->slug, 'title' => $mission->title]], 201);
    }
}
