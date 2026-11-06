<?php

declare(strict_types=1);

namespace App\Domain\FlightSessions\Data\Net;

use Spatie\LaravelData\Data;
use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/**
 * Место в составе вылета: игрок или ИИ.
 */
#[TypeScript]
final class NetSeatData extends Data
{
    public function __construct(
        public string $seat,
        public ?int $user_id,
        public ?string $callsign,
        public bool $is_ai,
    ) {}
}
