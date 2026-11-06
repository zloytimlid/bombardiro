<?php

declare(strict_types=1);

namespace App\Domain\FlightSessions\Data\Net;

use Spatie\LaravelData\Attributes\Validation\Min;
use Spatie\LaravelData\Attributes\Validation\Regex;
use Spatie\LaravelData\Data;
use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/**
 * Событие журнала вылета (раздел 9.3): номер по порядку, тик симуляции, тип и данные.
 */
#[TypeScript]
final class NetEventData extends Data
{
    /**
     * @param  array<string, mixed>|null  $payload
     */
    public function __construct(
        #[Min(1)]
        public int $seq,
        #[Min(0)]
        public int $tick,
        #[Regex('/^[a-z_]{1,48}$/')]
        public string $type,
        public ?array $payload = [],
    ) {}
}
