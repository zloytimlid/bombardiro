<?php

declare(strict_types=1);

namespace App\Domain\FlightSessions\Data\Net;

use Spatie\LaravelData\Attributes\DataCollectionOf;
use Spatie\LaravelData\Attributes\Validation\Max;
use Spatie\LaravelData\Attributes\Validation\Min;
use Spatie\LaravelData\Data;
use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/**
 * Пакет событий от хоста раз в 2 с: POST /api/sessions/{id}/events, идемпотентно по seq.
 */
#[TypeScript]
final class NetEventBatchData extends Data
{
    /**
     * @param  list<NetEventData>  $events
     */
    public function __construct(
        #[Min(1)]
        public int $v,
        #[DataCollectionOf(NetEventData::class), Max(500)]
        public array $events = [],
    ) {}
}
