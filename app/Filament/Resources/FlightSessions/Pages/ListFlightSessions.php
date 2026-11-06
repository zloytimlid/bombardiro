<?php

declare(strict_types=1);

namespace App\Filament\Resources\FlightSessions\Pages;

use App\Filament\Resources\FlightSessions\FlightSessionResource;
use Filament\Resources\Pages\ListRecords;

final class ListFlightSessions extends ListRecords
{
    protected static string $resource = FlightSessionResource::class;
}
