<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Domain\Aircraft\Enums\Station;
use App\Domain\Aircraft\Models\AircraftType;
use App\Domain\Missions\Models\Mission;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Тренировки станций (этап 2): у каждой из 8 станций — свой сценарий с оценкой.
 * Сценарии строятся в симядре на основе обучающей миссии «Милк-ран».
 */
final class TrainingController extends Controller
{
    private const string TRAINING_MISSION = 'milk-run';

    public function show(Request $request, Station $station): Response
    {
        $aircraft = AircraftType::query()->where('slug', 'b25j')->firstOrFail();
        $mission = Mission::latestPublished(self::TRAINING_MISSION);

        abort_if($mission === null, 404);

        $theatre = $mission->theatre;
        $difficulty = $request->query('difficulty') === 'historical' ? 'historical' : 'training';

        return Inertia::render('training/Station', [
            'station' => $station->value,
            'difficulty' => $difficulty,
            'seed' => random_int(1, 2_147_483_647),
            'aircraftConfig' => $aircraft->config,
            'mission' => $mission->definition,
            'theatre' => [
                'name' => $theatre->localizedName(app()->getLocale()),
                'placeholder' => $theatre->placeholder,
                'definition' => $theatre->definition,
            ],
        ]);
    }
}
