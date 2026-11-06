<?php

declare(strict_types=1);

namespace App\Domain\FlightSessions\Events;

use App\Domain\FlightSessions\Models\FlightSession;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;

/**
 * Миграция хоста (раздел 9.3): новый хост берёт свежий снапшот и продолжает.
 */
final class HostChanged implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets;

    public string $session;

    public int $hostUserId;

    public function __construct(FlightSession $session, public string $reason)
    {
        $this->session = $session->ulid;
        $this->hostUserId = (int) $session->host_user_id;
    }

    public function broadcastOn(): PrivateChannel
    {
        return new PrivateChannel('session.'.$this->session);
    }

    public function broadcastAs(): string
    {
        return 'HostChanged';
    }
}
