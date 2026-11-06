<?php

declare(strict_types=1);

namespace App\Domain\FlightSessions\Events;

use App\Domain\FlightSessions\Models\FlightSession;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;

/**
 * Серверный разбор готов (раздел 11: DebriefReady): страница разбора перестаёт опрашивать API.
 */
final class DebriefReady implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets;

    public string $session;

    public function __construct(FlightSession $session, public ?int $score, public bool $verified)
    {
        $this->session = $session->ulid;
    }

    public function broadcastOn(): PrivateChannel
    {
        return new PrivateChannel('session.'.$this->session);
    }

    public function broadcastAs(): string
    {
        return 'DebriefReady';
    }
}
