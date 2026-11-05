import type { Station } from './config';
import { STATIONS } from './config';
import type { Health } from './crew';
import { failed } from './damage';
import { toTrackFrame } from './bombsight';
import { TICK_HZ } from './simulation';
import type { MissionWorld, Outcome } from './world';

/**
 * Разбор вылета (раздел 8.2, фаза 10; метрики станций — раздел 6): результат по цели,
 * возврат самолёта, состояние экипажа, время над целью, личные метрики, схема разрывов.
 * Итог команды — главное; личные метрики — дополнение, не рейтинг против своих (раздел 6.7).
 */
export type MetricValue = { key: string; value: number | null; unit: string };

export type Debrief = {
    missionId: string;
    outcome: Outcome | 'aborted';
    durationS: number;
    target: { id: string; status: 'destroyed' | 'damaged' | 'intact'; percent: number; attackedKnownTarget: boolean };
    timeOverTarget: { plannedS: number; actualS: number | null; deviationS: number | null; windowS: number; withinWindow: boolean };
    crew: { station: Station; health: Health; bailedOut: boolean; ai: boolean }[];
    score: { total: number; parts: { target: number; aircraft: number; crew: number; timing: number } };
    stations: Record<Station, MetricValue[]>;
    /** Разрывы относительно точки прицеливания в осях цели (вдоль/поперёк), м. */
    impacts: { along: number; across: number; missM: number; armed: boolean }[];
    track: { t: number; x: number; y: number; z: number }[];
    timeline: { t: number; type: string; payload: Record<string, unknown> }[];
};

const TIMELINE_TYPES = new Set([
    'phase',
    'bombs_released',
    'bomb_impact',
    'fire',
    'fire_out',
    'wound',
    'engine_seized',
    'fighter_down',
    'wave_spawned',
    'message_received',
    'message_decoded',
    'control_handover',
    'bailed_out',
    'outcome',
    'abort',
    'zone_destroyed',
]);

const rms = (sumSq: number, n: number): number | null => (n > 0 ? Math.sqrt(sumSq / n) : null);

const round = (v: number | null, digits = 1): number | null => (v === null || !Number.isFinite(v) ? null : Math.round(v * 10 ** digits) / 10 ** digits);

function median(values: number[]): number | null {
    if (values.length === 0) {
        return null;
    }

    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);

    return sorted.length % 2 === 1 ? (sorted[mid] ?? null) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

function gunnerMetrics(world: MissionWorld, station: Station): MetricValue[] {
    const mounts = world.mounts.filter((m) => m.station === station && !m.fixed);
    const shots = mounts.reduce((s, m) => s + m.shotsFired, 0);
    const hits = mounts.reduce((s, m) => s + m.hits, 0);
    const delays = world.metrics.threatReportDelays;

    return [
        { key: 'accuracy', value: shots > 0 ? round((hits / shots) * 100) : null, unit: '%' },
        { key: 'kills', value: world.metrics.kills[station] ?? 0, unit: '' },
        { key: 'damaged', value: world.metrics.damagedFighters[station] ?? 0, unit: '' },
        { key: 'ammo_used', value: shots, unit: 'rounds' },
        { key: 'report_time', value: delays.length > 0 ? round(delays.reduce((a, b) => a + b, 0) / delays.length) : null, unit: 's' },
    ];
}

export function stationMetrics(world: MissionWorld): Record<Station, MetricValue[]> {
    const m = world.metrics;
    const br = m.bombRun;
    const fuelUsed = m.fuelAtStartKg - world.aircraft.fuelKg.reduce((a, b) => a + b, 0);
    const misses = world.impacts.map((i) => i.missM);
    const radio = world.radio;
    const decoded = radio.received.filter((r) => r.decodedTick !== null);
    const reaction = decoded.length > 0 ? decoded.reduce((s, r) => s + ((r.decodedTick ?? 0) - r.receivedTick), 0) / decoded.length / TICK_HZ : null;
    const tot = m.timeOverTargetS === null ? null : m.timeOverTargetS - world.mission.time_over_target.at_s;
    const totalMessages = radio.received.length + radio.missed;

    return {
        pilot: [
            { key: 'course_dev', value: round(((rms(br.headingSq, br.samples) ?? NaN) * 180) / Math.PI), unit: '°' },
            { key: 'altitude_dev', value: round(rms(br.altitudeSq, br.samples), 0), unit: 'm' },
            { key: 'speed_dev', value: round((rms(br.speedSq, br.samples) ?? NaN) * 3.6), unit: 'km/h' },
            { key: 'touchdown_vs', value: round(world.aircraft.touchdownVs, 2), unit: 'm/s' },
            { key: 'formation_time', value: Math.round(m.formationS), unit: 's' },
        ],
        copilot: [
            { key: 'red_zone', value: round(world.aircraft.engines.reduce((s, e) => s + e.secondsInRed, 0), 0), unit: 's' },
            { key: 'fuel_vs_plan', value: round((fuelUsed / world.mission.loadout.planned_burn_kg - 1) * 100, 0), unit: '%' },
            { key: 'missed_items', value: m.missedChecklistItems, unit: '' },
        ],
        navigator: [
            { key: 'dr_error_ip', value: round(world.nav.errorAtIpM === null ? null : world.nav.errorAtIpM / 1000, 2), unit: 'km' },
            { key: 'tot_deviation', value: round(tot, 0), unit: 's' },
            { key: 'corrections', value: world.nav.corrections, unit: '' },
            { key: 'fixes', value: world.nav.fixes, unit: '' },
        ],
        bombardier: [
            { key: 'mean_miss', value: misses.length > 0 ? round(misses.reduce((a, b) => a + b, 0) / misses.length, 0) : null, unit: 'm' },
            { key: 'cep', value: round(median(misses), 0), unit: 'm' },
            { key: 'target_damage', value: world.targetResult().percent, unit: '%' },
            { key: 'sight_failed', value: failed(world.damage, 'bombsight') ? 1 : 0, unit: '' },
        ],
        radio: [
            { key: 'received_share', value: totalMessages > 0 ? round((radio.received.length / totalMessages) * 100, 0) : null, unit: '%' },
            { key: 'reaction', value: round(reaction), unit: 's' },
            { key: 'decode_errors', value: radio.received.filter((r) => r.correct === false).length, unit: '' },
            { key: 'iff', value: radio.iff ? 1 : 0, unit: '' },
        ],
        top_gunner: gunnerMetrics(world, 'top_gunner'),
        waist_gunner: gunnerMetrics(world, 'waist_gunner'),
        tail_gunner: gunnerMetrics(world, 'tail_gunner'),
    };
}

const AIRCRAFT_SCORE: Record<Outcome | 'aborted', number> = {
    landed: 1,
    landed_off_field: 0.8,
    belly_landed: 0.6,
    ditched: 0.3,
    bailed_out: 0.1,
    crashed: 0,
    aborted: 0,
};

export function buildDebrief(world: MissionWorld): Debrief {
    const outcome = world.outcome ?? 'aborted';
    const result = world.targetResult();
    const attackedKnownTarget = world.knownTargetId === world.target.def.id;
    const plannedS = world.mission.time_over_target.at_s;
    const windowS = world.mission.time_over_target.window_s;
    const actualS = world.metrics.timeOverTargetS;
    const deviationS = actualS === null ? null : actualS - plannedS;
    const withinWindow = deviationS !== null && Math.abs(deviationS) <= windowS;

    // Части итога 0..1.
    const target = result.status === 'destroyed' ? 1 : result.status === 'damaged' ? 0.7 * (result.percent / 100) : 0;
    const damageShare =
        world.config.damage_model.value.zones.reduce((s, z) => s + (1 - world.damage.zoneHp[z.id] / z.hp), 0) / world.config.damage_model.value.zones.length;
    const aircraft = AIRCRAFT_SCORE[outcome] * (1 - 0.3 * damageShare);
    const crewValues = STATIONS.map((s): number => {
        const m = world.member(s);

        if (outcome === 'crashed' && !m.bailedOut) {
            return 0;
        }

        return m.health === 'ok' ? 1 : m.health === 'wounded' ? 0.6 : 0.1;
    });
    const crew = crewValues.reduce((a, b) => a + b, 0) / crewValues.length;
    const timing = deviationS === null ? 0 : withinWindow ? 1 : Math.max(0, 1 - (Math.abs(deviationS) - windowS) / 240);
    const w = world.mission.scoring;
    const weightSum = w.target + w.aircraft + w.crew + w.timing || 1;
    const total = Math.round((100 * (w.target * target + w.aircraft * aircraft + w.crew * crew + w.timing * timing)) / weightSum);
    const aim = world.target;

    return {
        missionId: world.mission.id,
        outcome,
        durationS: Math.round(world.timeS),
        target: { id: aim.def.id, status: result.status, percent: result.percent, attackedKnownTarget },
        timeOverTarget: { plannedS, actualS: actualS === null ? null : Math.round(actualS), deviationS: deviationS === null ? null : Math.round(deviationS), windowS, withinWindow },
        crew: STATIONS.map((s) => {
            const m = world.member(s);

            return { station: s, health: m.health, bailedOut: m.bailedOut, ai: m.controller === 'ai' };
        }),
        score: { total, parts: { target: round(target, 2) ?? 0, aircraft: round(aircraft, 2) ?? 0, crew: round(crew, 2) ?? 0, timing: round(timing, 2) ?? 0 } },
        stations: stationMetrics(world),
        impacts: world.impacts.map((i) => {
            const local = toTrackFrame({ x: i.position.x - aim.aim.x, y: i.position.y - aim.aim.y }, aim.heading);

            return { along: Math.round(local.along), across: Math.round(local.across), missM: Math.round(i.missM), armed: i.armed };
        }),
        track: world.track,
        timeline: world.events.filter((e) => TIMELINE_TYPES.has(e.type)).map((e) => ({ t: Math.round(e.tick / TICK_HZ), type: e.type, payload: e.payload })),
    };
}
