<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Domain\Aircraft\Enums\Station;
use App\Domain\Aircraft\Models\AircraftType;
use App\Domain\Missions\Models\Theatre;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

final class TrainingController extends Controller
{
    /** Станции, у которых уже есть игровой клиент (этап 1 — только пилот). */
    private const array AVAILABLE = [Station::Pilot];

    public function show(Request $request, Station $station): Response
    {
        $aircraft = AircraftType::query()->where('slug', 'b25j')->firstOrFail();
        $theatre = Theatre::query()->where('slug', 'corsica')->firstOrFail();
        $difficulty = $request->query('difficulty') === 'historical' ? 'historical' : 'training';

        return Inertia::render('training/Station', [
            'station' => $station->value,
            'available' => in_array($station, self::AVAILABLE, true),
            'difficulty' => $difficulty,
            'seed' => random_int(1, 2_147_483_647),
            'aircraftConfig' => $aircraft->config,
            'theatre' => [
                'name' => $theatre->localizedName(app()->getLocale()),
                'placeholder' => $theatre->placeholder,
                'definition' => $theatre->definition,
            ],
        ]);
    }
}
