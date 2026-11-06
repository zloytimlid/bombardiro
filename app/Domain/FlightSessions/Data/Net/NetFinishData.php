<?php

declare(strict_types=1);

namespace App\Domain\FlightSessions\Data\Net;

use Spatie\LaravelData\Attributes\Validation\In;
use Spatie\LaravelData\Attributes\Validation\Max;
use Spatie\LaravelData\Attributes\Validation\Min;
use Spatie\LaravelData\Data;
use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/**
 * Итог вылета от хоста: POST /api/sessions/{id}/finish. Сервер пересчитывает цель, время
 * над целью и итог по журналу, от хоста берёт только то, чего в журнале нет (состояние экипажа,
 * метрики станций, трек), и проверяет правдоподобие (раздел 9.3).
 */
#[TypeScript]
final class NetFinishData extends Data
{
    /**
     * @param  list<array{station: string, health: string, bailedOut: bool}>  $crew
     * @param  array<string, list<array{key: string, value: int|float|null, unit: string}>>  $stations
     * @param  list<array{t: int, x: int, y: int, z: int}>  $track
     * @param  array<string, float>  $zones  прочность зон в конце вылета 0…1 (кампания: повреждения сохраняются)
     */
    public function __construct(
        #[Min(1)]
        public int $v,
        #[In(['landed', 'landed_off_field', 'belly_landed', 'ditched', 'crashed', 'bailed_out', 'aborted'])]
        public string $outcome,
        #[Min(0)]
        public int $last_seq,
        #[Min(0), Max(1)]
        public float $damage_share,
        #[Min(0)]
        public int $duration_s,
        public ?array $crew = [],
        public ?array $stations = [],
        public ?array $track = [],
        public ?array $zones = [],
    ) {}
}
