<?php

declare(strict_types=1);

use App\Domain\Aircraft\Actions\SyncSimContent;
use App\Domain\FlightSessions\Enums\FlightSessionStatus;
use App\Domain\FlightSessions\Models\FlightSession;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\File;

it('prepares crews and started sessions for the k6 load run', function (): void {
    app(SyncSimContent::class)->handle();
    Event::fake();

    $this->artisan('load:prepare', ['crews' => 2])->assertSuccessful();

    $fixture = json_decode(File::get(storage_path('app/k6/fixture.json')), true);

    expect($fixture)->toHaveCount(2)
        ->and($fixture[0]['members'])->toHaveCount(8)
        ->and($fixture[0]['members'])->toContain($fixture[0]['host'])
        ->and(FlightSession::query()->where('status', FlightSessionStatus::Active)->count())->toBe(2);

    // Повторный прогон: старые экипажи не мешают.
    $this->artisan('load:prepare', ['crews' => 1])->assertSuccessful();
});
