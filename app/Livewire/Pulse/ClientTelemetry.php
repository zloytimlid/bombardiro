<?php

declare(strict_types=1);

namespace App\Livewire\Pulse;

use Illuminate\Contracts\Support\Renderable;
use Laravel\Pulse\Livewire\Card;
use Livewire\Attributes\Lazy;

/**
 * Карточка Pulse: клиентская телеметрия (раздел 13) — средний и минимальный FPS по пресету графики,
 * RTT хост–клиент в кооперативе. Данные — POST /api/telemetry, агрегаты Pulse.
 */
#[Lazy]
final class ClientTelemetry extends Card
{
    public function render(): Renderable
    {
        [$fps, $time, $runAt] = $this->remember(fn () => $this->aggregate('client_fps', ['avg', 'min', 'count']));
        [$rtt] = $this->remember(fn () => $this->aggregate('client_rtt', ['avg', 'max', 'count']), 'rtt');

        return view('livewire.pulse.client-telemetry', ['fps' => $fps, 'rtt' => $rtt, 'time' => $time, 'runAt' => $runAt]);
    }
}
