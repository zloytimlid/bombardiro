<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Domain\Missions\Models\Mission;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/missions, GET /api/missions/{slug} (раздел 11): каталог опубликованных миссий.
 */
final class MissionCatalogController extends Controller
{
    public function index(): JsonResponse
    {
        $missions = Mission::query()->latestPublished()->catalogOrder()->get();

        return response()->json([
            'data' => $missions->map(fn (Mission $m): array => [
                'slug' => $m->slug,
                'version' => $m->version,
                'title' => $m->title,
                'difficulty' => $m->difficulty->value,
                'placeholder' => $m->placeholder,
                'historical_date' => $m->historical_date?->toDateString(),
            ])->values(),
        ]);
    }

    public function show(string $slug): JsonResponse
    {
        $mission = Mission::latestPublished($slug);

        abort_if($mission === null, 404);

        return response()->json([
            'data' => [
                'slug' => $mission->slug,
                'version' => $mission->version,
                'title' => $mission->title,
                'theatre' => $mission->theatre->slug,
                'definition' => $mission->definition,
                'sources' => $mission->sources,
            ],
        ]);
    }
}
