<?php

declare(strict_types=1);

namespace App\Domain\Crews\Support;

use App\Domain\Campaigns\Models\CampaignProgress;
use App\Domain\Crews\Models\Crew;
use App\Domain\Crews\Models\CrewMember;
use App\Domain\Flights\Models\Flight;

/**
 * Состав лобби для страницы и broadcast-событий: одна структура — один источник.
 */
final class CrewRoster
{
    /**
     * @return array{
     *     ulid: string,
     *     rev: int,
     *     name: string,
     *     invite_code: string,
     *     status: string,
     *     owner_id: int|null,
     *     host_user_id: int|null,
     *     max_players: int,
     *     difficulty: string,
     *     mission: array{slug: string, title: array<string, string>},
     *     campaign: array{slug: string, title: array<string, string>, step: int, day: int, missions: list<string>, damaged: array<string, float>, completed: bool}|null,
     *     flight: array{ulid: string, invite_code: string, slot: int, leader: bool, crews: list<array{name: string, slot: int}>}|null,
     *     members: array<int, array{user_id: int, callsign: string, seat: string|null, is_ready: bool, rtt_ms: int|null}>
     * }
     */
    public static function of(Crew $crew): array
    {
        $crew->loadMissing(['mission', 'members.user.pilotProfile']);

        return [
            'ulid' => $crew->ulid,
            // Монотонная ревизия (мкс): события лобби могут прийти не по порядку, клиент берёт самую свежую.
            'rev' => (int) (microtime(true) * 1_000_000),
            'name' => $crew->name,
            'invite_code' => $crew->invite_code,
            'status' => $crew->status->value,
            'owner_id' => $crew->owner_id,
            'host_user_id' => $crew->host_user_id,
            'max_players' => $crew->max_players,
            'difficulty' => $crew->difficulty,
            'mission' => ['slug' => $crew->mission->slug, 'title' => $crew->mission->title],
            'campaign' => self::campaign($crew),
            'flight' => self::flight($crew),
            'members' => $crew->members
                ->sortBy('joined_at')
                ->values()
                ->map(fn (CrewMember $m): array => [
                    'user_id' => $m->user_id,
                    'callsign' => $m->user->pilotProfile->callsign ?? $m->user->name,
                    'seat' => $m->seat?->value,
                    'is_ready' => $m->is_ready,
                    'rtt_ms' => $m->rtt_ms,
                ])
                ->all(),
        ];
    }

    /**
     * Звено экипажа (этап 6): код, место в строю, экипажи звена.
     *
     * @return array{ulid: string, invite_code: string, slot: int, leader: bool, crews: list<array{name: string, slot: int}>}|null
     */
    private static function flight(Crew $crew): ?array
    {
        $flight = $crew->flight_id !== null ? Flight::query()->find($crew->flight_id) : null;

        if ($flight === null) {
            return null;
        }

        return [
            'ulid' => $flight->ulid,
            'invite_code' => $flight->invite_code,
            'slot' => (int) $crew->flight_slot,
            'leader' => $flight->leader_crew_id === $crew->id,
            'crews' => array_values(Crew::query()->where('flight_id', $flight->id)->orderBy('flight_slot')->get(['name', 'flight_slot'])
                ->map(fn (Crew $c): array => ['name' => $c->name, 'slot' => (int) $c->flight_slot])->all()),
        ];
    }

    /**
     * Кампания экипажа (этап 6): шаг, день, миссии, зоны борта с неотремонтированными повреждениями.
     *
     * @return array{slug: string, title: array<string, string>, step: int, day: int, missions: list<string>, damaged: array<string, float>, completed: bool}|null
     */
    private static function campaign(Crew $crew): ?array
    {
        if ($crew->campaign_progress_id === null) {
            return null;
        }

        $progress = CampaignProgress::query()->with('campaign')->find($crew->campaign_progress_id);

        if ($progress === null) {
            return null;
        }

        return [
            'slug' => $progress->campaign->slug,
            'title' => $progress->campaign->title,
            'step' => $progress->step,
            'day' => $progress->day,
            'missions' => $progress->campaign->missions,
            'damaged' => array_map(fn ($v): float => (float) $v, $progress->airframe_state['zones'] ?? []),
            'completed' => $progress->completed_at !== null,
        ];
    }
}
