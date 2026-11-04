<?php

declare(strict_types=1);

namespace App\Events\Diagnostics;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PresenceChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;

/**
 * Тестовое серверное событие этапа 0: проверяет цепочку Laravel → Reverb → браузеры.
 */
final class RadioCheck implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets;

    public function __construct(
        public readonly string $callsign,
        public readonly string $message,
        public readonly string $sentAt,
    ) {}

    public function broadcastOn(): PresenceChannel
    {
        return new PresenceChannel('diagnostics');
    }

    public function broadcastAs(): string
    {
        return 'radio-check';
    }
}
