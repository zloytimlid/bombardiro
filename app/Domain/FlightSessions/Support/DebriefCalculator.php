<?php

declare(strict_types=1);

namespace App\Domain\FlightSessions\Support;

use App\Domain\FlightSessions\Models\FlightSession;
use App\Domain\FlightSessions\Models\FlightSessionEvent;
use Illuminate\Support\Collection;
use JsonException;
use RuntimeException;

/**
 * Серверный разбор (раздел 8.5): итог вылета по журналу событий — поражение цели,
 * время над целью, возврат самолёта, состояние экипажа; веса — из scoring миссии.
 * Формулы совпадают с buildDebrief симядра (resources/js/sim/core/debrief.ts).
 * Плюс проверка правдоподобия (раздел 9.3): невозможное помечает вылет для модерации.
 */
final class DebriefCalculator
{
    private const int TICK_HZ = 60;

    private const float MAX_GROUND_SPEED_MS = 220.0;

    /** @var array<string, float> */
    private const array AIRCRAFT_SCORE = [
        'landed' => 1.0,
        'landed_off_field' => 0.8,
        'belly_landed' => 0.6,
        'ditched' => 0.3,
        'bailed_out' => 0.1,
        'crashed' => 0.0,
        'aborted' => 0.0,
    ];

    private const array TIMELINE_TYPES = [
        'phase', 'bombs_released', 'bomb_impact', 'fire', 'fire_out', 'wound', 'engine_seized', 'fighter_down',
        'wave_spawned', 'message_received', 'message_decoded', 'control_handover', 'bailed_out', 'outcome', 'abort',
        'zone_destroyed', 'host_changed',
    ];

    /**
     * @return array{debrief: array<string, mixed>, score: int, outcome: string, flags: list<string>}
     *
     * @throws JsonException
     */
    public function compute(FlightSession $session): array
    {
        $session->loadMissing(['mission.theatre', 'participants']);
        /** @var array<string, mixed> $summary */
        $summary = $session->debrief['summary'] ?? [];
        $mission = $session->mission->definition;
        /** @var Collection<int, FlightSessionEvent> $events */
        $events = $session->events()->orderBy('seq')->get();
        $outcome = (string) ($summary['outcome'] ?? 'aborted');

        // Цель: официальная на конец вылета (смена цели по триггеру) и её разрушение по разрывам.
        $target = $this->finalTarget($mission, $events);
        $impacts = $events->where('type', 'bomb_impact');
        [$status, $percent, $impactPlot] = $this->targetDamage($session, $target, $impacts);

        $changed = $events->contains(fn (FlightSessionEvent $e): bool => $e->type === 'target_changed');
        $decodedChange = $events->contains(fn (FlightSessionEvent $e): bool => $e->type === 'message_decoded' && ($e->payload['meaning'] ?? null) === 'change_target' && ($e->payload['correct'] ?? false) === true);

        // Время над целью — первый штатный сброс.
        $release = $events->first(fn (FlightSessionEvent $e): bool => $e->type === 'bombs_released' && ($e->payload['emergency'] ?? false) === false);
        $plannedS = (int) ($mission['time_over_target']['at_s'] ?? 0);
        $windowS = (int) ($mission['time_over_target']['window_s'] ?? 60);
        $actualS = $release === null ? null : (int) round($release->tick / self::TICK_HZ);
        $deviationS = $actualS === null ? null : $actualS - $plannedS;
        $within = $deviationS !== null && abs($deviationS) <= $windowS;

        // Части итога 0..1 — как в симядре.
        $partTarget = $status === 'destroyed' ? 1.0 : ($status === 'damaged' ? 0.7 * ($percent / 100) : 0.0);
        $partAircraft = (self::AIRCRAFT_SCORE[$outcome] ?? 0.0) * (1 - 0.3 * (float) ($summary['damage_share'] ?? 0));
        /** @var list<array{station: string, health: string, bailedOut: bool}> $crew */
        $crew = $summary['crew'] ?? [];
        $crewValues = array_map(function (array $m) use ($outcome): float {
            if ($outcome === 'crashed' && ! $m['bailedOut']) {
                return 0.0;
            }

            return match ($m['health']) {
                'ok' => 1.0,
                'wounded' => 0.6,
                default => 0.1,
            };
        }, $crew);
        $partCrew = $crewValues === [] ? 0.0 : array_sum($crewValues) / count($crewValues);
        $partTiming = $deviationS === null ? 0.0 : ($within ? 1.0 : max(0.0, 1 - (abs($deviationS) - $windowS) / 240));

        $w = $mission['scoring'] ?? ['target' => 1, 'aircraft' => 1, 'crew' => 1, 'timing' => 1];
        $weightSum = ($w['target'] + $w['aircraft'] + $w['crew'] + $w['timing']) ?: 1;
        $total = (int) round(100 * ($w['target'] * $partTarget + $w['aircraft'] * $partAircraft + $w['crew'] * $partCrew + $w['timing'] * $partTiming) / $weightSum);

        // ИИ или игрок — по последнему периоду занятия каждого места.
        $ai = $session->participants
            ->sortBy('id')
            ->groupBy(fn ($p): string => $p->seat->value)
            ->map(fn ($rows): bool => (bool) $rows->last()?->is_ai);

        $flags = $this->verify($session, $mission, $events, $summary);

        $debrief = [
            'missionId' => $mission['id'] ?? $session->mission->slug,
            'outcome' => $outcome,
            'durationS' => (int) ($summary['duration_s'] ?? 0),
            'target' => ['id' => $target['id'] ?? '', 'status' => $status, 'percent' => $percent, 'attackedKnownTarget' => ! $changed || $decodedChange],
            'timeOverTarget' => ['plannedS' => $plannedS, 'actualS' => $actualS, 'deviationS' => $deviationS, 'windowS' => $windowS, 'withinWindow' => $within],
            'crew' => array_map(fn (array $m): array => [...$m, 'ai' => (bool) ($ai[$m['station']] ?? true)], $crew),
            'score' => ['total' => $total, 'parts' => [
                'target' => round($partTarget, 2),
                'aircraft' => round($partAircraft, 2),
                'crew' => round($partCrew, 2),
                'timing' => round($partTiming, 2),
            ]],
            'stations' => $summary['stations'] ?? [],
            'impacts' => $impactPlot,
            'track' => $summary['track'] ?? [],
            'timeline' => $events
                ->filter(fn (FlightSessionEvent $e): bool => in_array($e->type, self::TIMELINE_TYPES, true))
                ->map(fn (FlightSessionEvent $e): array => ['t' => (int) round($e->tick / self::TICK_HZ), 'type' => $e->type, 'payload' => $e->payload])
                ->values()
                ->all(),
            'verified' => $flags === [],
            'flags' => $flags,
        ];

        return ['debrief' => $debrief, 'score' => $total, 'outcome' => $outcome, 'flags' => $flags];
    }

    /**
     * @param  array<string, mixed>  $mission
     * @param  Collection<int, FlightSessionEvent>  $events
     * @return array<string, mixed>
     */
    private function finalTarget(array $mission, Collection $events): array
    {
        $changed = $events->last(fn (FlightSessionEvent $e): bool => $e->type === 'target_changed');

        if ($changed !== null) {
            foreach ($mission['alternate_targets'] ?? [] as $alt) {
                if (($alt['id'] ?? null) === ($changed->payload['target'] ?? null)) {
                    return $alt;
                }
            }
        }

        return $mission['target'];
    }

    /**
     * Повреждение секций цели по разрывам — та же формула, что в MissionWorld.bombImpact.
     *
     * @param  array<string, mixed>  $target
     * @param  Collection<int, FlightSessionEvent>  $impacts
     * @return array{0: string, 1: int, 2: list<array{along: int, across: int, missM: int, armed: bool}>}
     *
     * @throws JsonException
     */
    private function targetDamage(FlightSession $session, array $target, Collection $impacts): array
    {
        $theatre = $session->mission->theatre;
        $lat0 = (float) $theatre->origin_lat;
        $lon0 = (float) $theatre->origin_lon;
        $k = cos(deg2rad($lat0));
        $aimX = ((float) $target['aim_point']['lon'] - $lon0) * 111320 * $k;
        $aimY = ((float) $target['aim_point']['lat'] - $lat0) * 110574;
        $h = deg2rad((float) $target['heading_deg']);
        $frame = fn (float $x, float $y): array => [
            ($x - $aimX) * sin($h) + ($y - $aimY) * cos($h),
            ($x - $aimX) * cos($h) - ($y - $aimY) * sin($h),
        ];
        $bombs = $this->bombTypes();
        $damage = array_fill(0, count($target['sections']), 0.0);
        $plot = [];

        foreach ($impacts as $impact) {
            $p = $impact->payload;
            [$along, $across] = $frame((float) $p['x'], (float) $p['y']);
            $plot[] = ['along' => (int) round($along), 'across' => (int) round($across), 'missM' => (int) ($p['miss_m'] ?? 0), 'armed' => (bool) ($p['armed'] ?? false)];

            if (! ($p['armed'] ?? false)) {
                continue;
            }

            $type = $bombs[$p['type'] ?? ''] ?? reset($bombs);

            if ($type === false) {
                continue;
            }

            foreach ($target['sections'] as $i => $section) {
                $dx = max(abs($along - (float) $section['offset_m'][0]) - $section['length_m'] / 2, 0);
                $dy = max(abs($across - (float) $section['offset_m'][1]) - $section['width_m'] / 2, 0);
                $dist = hypot($dx, $dy);

                if ($dist <= $type['lethal_radius_m']) {
                    $damage[$i] += $type['damage'];
                } elseif ($dist <= $type['damage_radius_m']) {
                    $damage[$i] += $type['damage'] * 0.5 * (1 - ($dist - $type['lethal_radius_m']) / ($type['damage_radius_m'] - $type['lethal_radius_m']));
                }
            }
        }

        $shares = [];

        foreach ($target['sections'] as $i => $section) {
            $shares[] = min(1.0, $damage[$i] / (float) $section['strength']);
        }

        $percent = (int) round(array_sum($shares) / max(count($shares), 1) * 100);
        $destroyedCount = count(array_filter($shares, fn (float $s): bool => $s >= 1));
        $destroyed = ($target['destroyed_when'] ?? 'any_section') === 'any_section' ? $destroyedCount > 0 : $destroyedCount === count($shares);

        return [$destroyed ? 'destroyed' : ($percent > 0 ? 'damaged' : 'intact'), $percent, $plot];
    }

    /**
     * Проверка правдоподобия: больше бомб, чем подвешено; сбитые до появления истребителей;
     * скорость выше предела; дыры в журнале.
     *
     * @param  array<string, mixed>  $mission
     * @param  Collection<int, FlightSessionEvent>  $events
     * @param  array<string, mixed>  $summary
     * @return list<string>
     */
    private function verify(FlightSession $session, array $mission, Collection $events, array $summary): array
    {
        $flags = [];
        $loaded = array_sum(array_map(fn (array $b): int => (int) $b['count'], $mission['loadout']['bombs'] ?? []));

        if ($events->where('type', 'bomb_impact')->count() > $loaded) {
            $flags[] = 'bombs_over_load';
        }

        $firstWave = $events->first(fn (FlightSessionEvent $e): bool => $e->type === 'wave_spawned');
        $spawned = $events->where('type', 'wave_spawned')->sum(fn (FlightSessionEvent $e): int => (int) ($e->payload['count'] ?? 0));
        $kills = $events->where('type', 'fighter_down');

        if ($kills->isNotEmpty() && ($firstWave === null || $kills->first()->seq < $firstWave->seq)) {
            $flags[] = 'kill_before_spawn';
        }

        if ($kills->count() > $spawned) {
            $flags[] = 'kills_over_spawned';
        }

        /** @var list<array{t: int, x: int, y: int, z: int}> $track */
        $track = $summary['track'] ?? [];

        for ($i = 1, $n = count($track); $i < $n; $i++) {
            $a = $track[$i - 1];
            $b = $track[$i];
            $dt = max($b['t'] - $a['t'], 1);

            if (hypot($b['x'] - $a['x'], $b['y'] - $a['y']) / $dt > self::MAX_GROUND_SPEED_MS) {
                $flags[] = 'overspeed';
                break;
            }
        }

        $lastSeq = (int) ($summary['last_seq'] ?? $session->last_seq);

        if ($events->count() < $lastSeq) {
            $flags[] = 'journal_incomplete';
        }

        return $flags;
    }

    /**
     * @return array<string, array{lethal_radius_m: float, damage_radius_m: float, damage: float}>
     *
     * @throws JsonException
     */
    private function bombTypes(): array
    {
        $contents = file_get_contents(resource_path('sim/weapons/bombs.json'));

        if ($contents === false) {
            throw new RuntimeException('Cannot read bombs.json');
        }

        $out = [];

        foreach (json_decode($contents, true, flags: JSON_THROW_ON_ERROR)['bombs'] as $bomb) {
            $out[$bomb['id']] = $bomb['gameplay']['value'];
        }

        return $out;
    }
}
