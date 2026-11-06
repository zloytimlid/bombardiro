<?php

declare(strict_types=1);

namespace App\Domain\FlightSessions\Data\Net;

use Spatie\LaravelData\Attributes\Validation\Max;
use Spatie\LaravelData\Attributes\Validation\Min;
use Spatie\LaravelData\Data;
use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/**
 * Отметка присутствия и RTT до сервера (раздел 9.1: хост — игрок с наименьшим RTT).
 */
#[TypeScript]
final class NetHeartbeatData extends Data
{
    public function __construct(
        #[Min(0), Max(10000)]
        public ?int $rtt_ms = null,
    ) {}
}
