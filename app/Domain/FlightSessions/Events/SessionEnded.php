<?php

declare(strict_types=1);

namespace App\Domain\FlightSessions\Events;

use App\Domain\FlightSessions\Models\FlightSession;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;

/**
 * Разбор готов: клиенты открывают /debrief/{session}.
 */
final class SessionEnded implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets;

    public string $session;

    public ?string $outcome;

    public ?int $score;

    public function __construct(FlightSession $session)
    {
        $this->session = $session->ulid;
        $this->outcome = $session->outcome;
        $this->score = $session->score;
    }

    public function broadcastOn(): PrivateChannel
    {
        return new PrivateChannel('session.'.$this->session);
    }

    public function broadcastAs(): string
    {
        return 'SessionEnded';
    }
}
