<?php

declare(strict_types=1);

namespace App\Domain\Crews\Events;

use App\Domain\Crews\Models\Crew;
use App\Domain\Crews\Support\CrewRoster;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PresenceChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;

/**
 * Место занято или освобождено (раздел 9.2). Несёт полный состав — клиенты просто заменяют его.
 */
final class SeatClaimed implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets;

    /** @var array<string, mixed> */
    public array $roster;

    public function __construct(Crew $crew, public int $userId, public ?string $seat)
    {
        $this->roster = CrewRoster::of($crew);
    }

    public function broadcastOn(): PresenceChannel
    {
        return new PresenceChannel('crew.'.$this->roster['ulid']);
    }

    public function broadcastAs(): string
    {
        return 'SeatClaimed';
    }
}
