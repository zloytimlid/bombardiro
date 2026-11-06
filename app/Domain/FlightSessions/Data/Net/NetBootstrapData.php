<?php

declare(strict_types=1);

namespace App\Domain\FlightSessions\Data\Net;

use Spatie\LaravelData\Attributes\DataCollectionOf;
use Spatie\LaravelData\Data;
use Spatie\TypeScriptTransformer\Attributes\TypeScript;

/**
 * GET /api/sessions/{id}/bootstrap (раздел 11): всё, чтобы войти в вылет — миссия, конфиг,
 * сид, состав, хост, версия протокола.
 */
#[TypeScript]
final class NetBootstrapData extends Data
{
    /**
     * @param  list<NetSeatData>  $roster
     * @param  array<string, mixed>  $mission
     * @param  array<string, mixed>  $aircraft_config
     * @param  array<string, mixed>  $theatre
     * @param  array<string, float>  $airframe_zones  прочность зон борта 0…1 (кампания); пусто — исправен
     */
    public function __construct(
        public int $v,
        public string $session,
        public string $crew,
        public string $status,
        public int $seed,
        public string $difficulty,
        public ?int $host_user_id,
        public int $user_id,
        public ?string $seat,
        #[DataCollectionOf(NetSeatData::class)]
        public array $roster,
        public array $mission,
        public array $aircraft_config,
        public array $theatre,
        public string $theatre_name,
        public bool $theatre_placeholder,
        public int $max_time_scale,
        public ?array $airframe_zones = [],
        /** @var array{ulid: string, slot: int, slots: list<array{slot: int, crew: string, name: string, session: string|null}>}|null */
        public ?array $flight = null,
    ) {}
}
