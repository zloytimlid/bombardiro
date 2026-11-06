<?php

declare(strict_types=1);

namespace App\Domain\FlightSessions\Data\Net;

use Spatie\LaravelData\Attributes\Validation\Min;
use Spatie\LaravelData\Data;
use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/**
 * Полный снапшот мира для миграции хоста: PUT /api/sessions/{id}/snapshot (Redis, TTL 10 мин).
 * Содержимое state сервер не разбирает — его восстанавливает новый хост.
 */
#[TypeScript]
final class NetSnapshotData extends Data
{
    /**
     * @param  array<string, mixed>|null  $state
     */
    public function __construct(
        #[Min(1)]
        public int $v,
        #[Min(0)]
        public int $tick,
        public ?array $state = [],
    ) {}
}
