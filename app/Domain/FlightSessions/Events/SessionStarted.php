<?php

declare(strict_types=1);

namespace App\Domain\FlightSessions\Events;

use App\Domain\FlightSessions\Models\FlightSession;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PresenceChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;

/**
 * Вылет создан: участники лобби переходят на /play/{session}.
 */
final class SessionStarted implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets;

    public string $session;

    public int $hostUserId;

    private string $crew;

    public function __construct(FlightSession $session)
    {
        $this->session = $session->ulid;
        $this->hostUserId = (int) $session->host_user_id;
        $this->crew = $session->crew->ulid;
    }

    public function broadcastOn(): PresenceChannel
    {
        return new PresenceChannel('crew.'.$this->crew);
    }

    public function broadcastAs(): string
    {
        return 'SessionStarted';
    }
}
