<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Domain\Aircraft\Models\AircraftType;
use App\Domain\Missions\Models\Mission;
use App\Domain\Missions\Models\Theatre;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Каталог миссий и одиночный вылет (этап 2): брифинг → вылет → разбор на клиенте.
 * Кооперативные вылеты с flight_sessions и серверным разбором — этап 3.
 */
final class MissionController extends Controller
{
    public function index(): Response
    {
        $missions = Mission::query()->latestPublished()->catalogOrder()->get();

        return Inertia::render('missions/Index', [
            'missions' => $missions->map(fn (Mission $m): array => [
                'slug' => $m->slug,
                'title' => $m->title,
                'difficulty' => $m->difficulty->value,
                'placeholder' => $m->placeholder,
                'historical_date' => $m->historical_date?->toDateString(),
                'version' => $m->version,
                'summary' => $m->summary(),
            ])->values(),
            // Генератор (этап 6): театр с пулом целей и шаблон миссии — только по запросу формы.
            'generator' => Inertia::optional(function (): ?array {
                $theatre = Theatre::query()->where('slug', 'mto-west')->first();
                $base = Mission::latestPublished('milk-run');

                return $theatre === null || $base === null ? null : [
                    'theatre' => $theatre->definition,
                    'base' => $base->definition,
                ];
            }),
        ]);
    }

    public function solo(Request $request, string $slug): Response
    {
        $mission = Mission::latestPublished($slug);

        abort_if($mission === null, 404);

        $aircraft = AircraftType::query()->where('slug', 'b25j')->firstOrFail();
        $theatre = $mission->theatre;

        return Inertia::render('missions/Solo', [
            'mission' => [
                'slug' => $mission->slug,
                'title' => $mission->title,
                'placeholder' => $mission->placeholder,
                'version' => $mission->version,
                'definition' => $mission->definition,
            ],
            // Вне продакшена сид можно зафиксировать (?debug_seed=) для воспроизводимых E2E.
            'seed' => ! app()->isProduction() && $request->integer('debug_seed') > 0 ? $request->integer('debug_seed') : random_int(1, 2_147_483_647),
            'aircraftConfig' => $aircraft->config,
            // Отладочное ускорение до ×16 — только вне продакшена (E2E «от брифинга до разбора»).
            'maxTimeScale' => app()->isProduction() ? 4 : min(16, max(4, $request->integer('debug_time_scale', 4))),
            'theatre' => [
                'name' => $theatre->localizedName(app()->getLocale()),
                'placeholder' => $theatre->placeholder,
                'definition' => $theatre->definition,
            ],
        ]);
    }
}
