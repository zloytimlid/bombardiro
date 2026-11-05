import { createCrewAI } from './ai/crew';
import type { AircraftConfig, Station } from './config';
import { STATIONS } from './config';
import type { ContentLibrary, Skill } from './content';
import { wound } from './crew';
import { startEngineFire } from './damage';
import type { MetricValue } from './debrief';
import { stationMetrics } from './debrief';
import { clamp, vec } from './math';
import type { FighterWaveDef, MissionDefinition } from './mission/schema';
import { toEnu } from './mission/geo';
import { TICK_HZ } from './simulation';
import type { TheatreConfig } from './terrain';
import type { Difficulty, WorldStart } from './world';
import { MissionWorld } from './world';

/**
 * Тренировки станций (этап 2: «у каждой из 8 станций есть тренировка с оценкой»).
 * Каждая — короткий сценарий на основе обучающей миссии: свой старт, свои условия
 * завершения и оценка 0–100 по метрикам станции из раздела 6.
 */
export type TrainingResult = { done: boolean; score: number; metrics: MetricValue[] };

export type TrainingDef = {
    station: Station;
    timeLimitS: number;
    /** Сценарий: старт, подготовленная миссия, кто молчит. */
    mission: (base: MissionDefinition) => MissionDefinition;
    start: (base: MissionDefinition, theatre: TheatreConfig) => WorldStart;
    aiDisabled: Station[];
    difficulty?: Difficulty;
    setup?: (world: MissionWorld) => void;
    tick?: (world: MissionWorld, state: Record<string, number>) => void;
    phaseHook?: (world: MissionWorld) => boolean;
    evaluate: (world: MissionWorld, state: Record<string, number>) => TrainingResult;
};

const GUNNERS: Station[] = ['top_gunner', 'waist_gunner', 'tail_gunner', 'radio', 'bombardier'];

const peaceful = (m: MissionDefinition): MissionDefinition => ({ ...m, threats: { flak: [], fighter_waves: [] }, triggers: [], formation: { ...m.formation, wingmen: 0 } });

/** Старт на боевом курсе: `distance` м до цели по линии IP → цель. */
function onBombRun(m: MissionDefinition, theatre: TheatreConfig, distance: number, altitude: number): WorldStart {
    const ip = m.waypoints.find((w) => w.type === 'ip');
    const target = toEnu(theatre, m.target.aim_point.lat, m.target.aim_point.lon);
    const from = ip ? toEnu(theatre, ip.lat, ip.lon) : vec(target.x - 20000, target.y, 0);
    const dx = target.x - from.x;
    const dy = target.y - from.y;
    const len = Math.hypot(dx, dy);
    const heading = Math.atan2(dx, dy);

    return {
        phase: 'bomb_run',
        position: vec(target.x - (dx / len) * distance, target.y - (dy / len) * distance, altitude),
        heading,
        speedMs: 98,
        enginesRunning: true,
        gearDown: false,
        legIndex: m.waypoints.findIndex((w) => w.type === 'target'),
    };
}

/** Старт на маршруте у точки wp1 курсом на IP. */
function onRoute(m: MissionDefinition, theatre: TheatreConfig): WorldStart {
    const wp1 = m.waypoints.find((w) => w.id === 'wp1') ?? m.waypoints[2];
    const ip = m.waypoints.find((w) => w.type === 'ip');
    const a = wp1 ? toEnu(theatre, wp1.lat, wp1.lon, wp1.alt_m) : vec(0, 0, 3000);
    const b = ip ? toEnu(theatre, ip.lat, ip.lon) : vec(a.x + 40000, a.y, 0);

    return {
        phase: 'route',
        position: vec(a.x, a.y, Math.max(a.z, 3000)),
        heading: Math.atan2(b.x - a.x, b.y - a.y),
        speedMs: 98,
        enginesRunning: true,
        gearDown: false,
        legIndex: ip ? m.waypoints.indexOf(ip) : 3,
    };
}

function gunnerTraining(station: Station, waves: FighterWaveDef[]): TrainingDef {
    return {
        station,
        timeLimitS: 300,
        mission: (m) => ({ ...peaceful(m), threats: { flak: [], fighter_waves: waves } }),
        start: onRoute,
        aiDisabled: GUNNERS.filter((s) => s !== station),
        setup: (world) => {
            for (const w of waves) {
                world.spawnWave(w.id);
            }

            if (station === 'waist_gunner') {
                wound(world.crew, 'radio', false, world.tick);
            }
        },
        evaluate: (world) => {
            const metrics = stationMetrics(world)[station === 'radio' || station === 'bombardier' ? 'top_gunner' : station];
            const kills = world.metrics.kills[station] ?? 0;
            const mounts = world.mounts.filter((m) => m.station === station && !m.fixed);
            const shots = mounts.reduce((s, m) => s + m.shotsFired, 0);
            const hits = mounts.reduce((s, m) => s + m.hits, 0);
            const accuracy = shots > 0 ? hits / shots : 0;
            const taken = Object.values(world.damage.hits).reduce((a, b) => a + b, 0);
            const firstAid = station === 'waist_gunner' ? (world.member('radio').treated ? 1 : 0) : null;
            const done = world.fighters.length === 0 || world.timeS > 300 || world.aircraftLost;
            const combat = 40 * Math.min(kills / 2, 1) + 30 * Math.min(accuracy / 0.06, 1) + 30 * (1 - Math.min(taken / 60, 1));
            const score = firstAid === null ? combat : 0.75 * combat + 25 * firstAid;

            return {
                done,
                score: Math.round(clamp(score, 0, 100)),
                metrics: [...metrics, { key: 'hits_taken', value: taken, unit: '' }, ...(firstAid === null ? [] : [{ key: 'first_aid', value: firstAid, unit: '' }])],
            };
        },
    };
}

const wave = (id: string, type: string, count: number, attacks: FighterWaveDef['attacks'], bearing: number, altitude: number): FighterWaveDef => ({
    id,
    type,
    count,
    skill: 'experienced',
    spawn: { bearing_deg: bearing, distance_m: 6000, altitude_offset_m: altitude },
    attacks,
});

export const TRAININGS: Record<Station, TrainingDef> = {
    // 1. Пилот: взлёт, заход через точку final и посадка. Оценка — касание, ось, исход.
    pilot: {
        station: 'pilot',
        timeLimitS: 900,
        mission: peaceful,
        start: () => ({ phase: 'takeoff', enginesRunning: true, bombs: [] }),
        aiDisabled: [],
        // Весь круг — в фазе «взлёт» (схема полёта по кругу, как на этапе 1); конец — остановка или авария.
        phaseHook: (world) => {
            const a = world.aircraft;

            if (a.contact === 'crashed') {
                world.end('crashed');
            } else if (a.touchdownVs !== null && a.contact !== 'air' && Math.hypot(a.velocity.x, a.velocity.y) < 1) {
                world.end(world.landingOutcome());
            }

            return true;
        },
        evaluate: (world) => {
            const a = world.aircraft;
            const r = world.runway;
            const across = Math.abs((a.position.x - r.x) * Math.cos(r.heading) - (a.position.y - r.y) * Math.sin(r.heading));
            const vs = a.touchdownVs;
            const outcomeScore = world.outcome === 'landed' ? 40 : world.outcome === 'landed_off_field' || world.outcome === 'belly_landed' ? 15 : 0;
            const touchdown = vs === null || world.outcome === 'crashed' ? 0 : 40 * clamp((3 - vs) / 2, 0, 1);
            const centre = world.outcome === 'landed' ? 20 * clamp(1 - across / (r.width_m / 2), 0, 1) : 0;

            return {
                done: world.phase === 'debrief',
                score: Math.round(outcomeScore + touchdown + centre),
                metrics: [
                    { key: 'touchdown_vs', value: vs === null ? null : Math.round(vs * 100) / 100, unit: 'm/s' },
                    { key: 'centerline', value: Math.round(across * 10) / 10, unit: 'm' },
                ],
            };
        },
    },
    // 2. Второй пилот: чек-листы и запуск, затем пожар двигателя после взлёта.
    copilot: {
        station: 'copilot',
        timeLimitS: 600,
        mission: peaceful,
        start: () => ({ phase: 'preflight', enginesRunning: false, bombs: [] }),
        aiDisabled: [],
        tick: (world, state) => {
            const a = world.aircraft;

            if (state.startedAt === undefined && a.engines.every((e) => e.mode === 'running')) {
                state.startedAt = world.timeS;
            }

            if (state.fireAt === undefined && a.contact === 'air' && world.derived().agl > 300) {
                state.fireAt = world.timeS;
                startEngineFire(world.damageContext(), world.damage, 0);
            }

            if (state.fireAt !== undefined && state.featheredAt === undefined && a.engines[0].feathered) {
                state.featheredAt = world.timeS;
            }

            if (state.fireAt !== undefined && state.fireOutAt === undefined && world.damage.engineFireS[0] === null) {
                state.fireOutAt = world.timeS;
            }
        },
        phaseHook: (world) => {
            if (world.phase === 'formup' && world.timeS > 0) {
                return true;
            }

            return false;
        },
        evaluate: (world, state) => {
            const startTime = state.startedAt ?? null;
            const response = state.fireAt !== undefined && state.featheredAt !== undefined ? state.featheredAt - state.fireAt : null;
            const fireOut = state.fireOutAt !== undefined;
            const missed = world.metrics.missedChecklistItems + (world.phase === 'preflight' ? 4 : 0);
            const done = world.aircraft.contact === 'crashed' || (state.fireAt !== undefined && world.timeS - state.fireAt > 60);
            const score =
                30 * (startTime === null ? 0 : clamp((150 - startTime) / 90, 0, 1)) +
                20 * clamp(1 - missed / 4, 0, 1) +
                25 * (response === null ? 0 : clamp((20 - response) / 15, 0, 1)) +
                25 * (fireOut ? 1 : 0);

            return {
                done,
                score: Math.round(score),
                metrics: [
                    { key: 'start_time', value: startTime === null ? null : Math.round(startTime), unit: 's' },
                    { key: 'missed_items', value: missed, unit: '' },
                    { key: 'feather_response', value: response === null ? null : Math.round(response * 10) / 10, unit: 's' },
                    { key: 'fire_out', value: fireOut ? 1 : 0, unit: '' },
                ],
            };
        },
    },
    // 3. Бомбардир: боевой курс с 14 км, ветер, серия по мосту.
    bombardier: {
        station: 'bombardier',
        timeLimitS: 300,
        mission: peaceful,
        start: (m, theatre) => onBombRun(m, theatre, 14000, 3000),
        aiDisabled: ['top_gunner', 'waist_gunner', 'tail_gunner', 'radio'],
        setup: (world) => {
            world.act('bombardier', { type: 'arm', on: true });
        },
        evaluate: (world) => {
            const misses = world.impacts.map((i) => i.missM);
            const mean = misses.length > 0 ? misses.reduce((a, b) => a + b, 0) / misses.length : null;
            const result = world.targetResult();
            const done = (world.rack.length === 0 && world.releaseQueue.length === 0 && world.bombs.length === 0) || world.timeS > 300;
            const score = mean === null ? 0 : 60 * clamp((150 - mean) / 130, 0, 1) + 40 * (result.percent / 100);

            return { done, score: Math.round(score), metrics: stationMetrics(world).bombardier };
        },
    },
    // 4. Штурман: участок wp1 → IP в «Историческом» режиме при сильном ветре, не совпадающем с прогнозом.
    navigator: {
        station: 'navigator',
        timeLimitS: 900,
        difficulty: 'historical',
        mission: (m) => ({
            ...peaceful(m),
            weather: { ...m.weather, wind: [{ altitude_m: 0, from_deg: 330, speed_ms: 8 }, { altitude_m: 3000, from_deg: 340, speed_ms: 16 }] },
        }),
        start: onRoute,
        aiDisabled: [],
        evaluate: (world) => {
            const err = world.nav.errorAtIpM;
            const done = err !== null || world.timeS > 900;
            const score = err === null ? 0 : 80 * clamp((4000 - err) / 3500, 0, 1) + 20 * clamp(world.nav.fixes / 1, 0, 1);

            return { done, score: Math.round(score), metrics: stationMetrics(world).navigator };
        },
    },
    // 5. Верхняя турель: смешанные атаки тройки.
    top_gunner: gunnerTraining('top_gunner', [wave('trainer', 'bf109g', 3, ['high_six', 'head_on', 'beam'], 160, 700)]),
    // 6. Радист: четыре передачи на разных частотах, расшифровка, «свой-чужой».
    radio: {
        station: 'radio',
        timeLimitS: 300,
        mission: (m) => ({ ...peaceful(m) }),
        start: onRoute,
        aiDisabled: ['top_gunner', 'waist_gunner', 'tail_gunner', 'bombardier'],
        tick: (world, state) => {
            const schedule: [number, string][] = [
                [5, 'weather'],
                [65, 'confirm'],
                [125, 'iff'],
                [185, 'clearance'],
            ];

            for (const [at, id] of schedule) {
                const key = `sent_${id}`;

                if (state[key] === undefined && world.timeS >= at) {
                    state[key] = 1;
                    world.runAction({ type: 'send_radio', message: id });
                }
            }
        },
        evaluate: (world) => {
            const radio = world.radio;
            const total = 4;
            const received = radio.received.length;
            const correct = radio.received.filter((r) => r.correct === true).length;
            const decoded = radio.received.filter((r) => r.decodedTick !== null);
            const reaction = decoded.length > 0 ? decoded.reduce((s, r) => s + ((r.decodedTick ?? 0) - r.receivedTick), 0) / decoded.length / TICK_HZ : null;
            const done = world.timeS > 260;
            const score = 45 * (received / total) + 35 * (correct / total) + 10 * (reaction === null ? 0 : clamp((30 - reaction) / 25, 0, 1)) + 10 * (radio.iff ? 1 : 0);

            return { done, score: Math.round(score), metrics: stationMetrics(world).radio };
        },
    },
    // 7. Бортовой стрелок: атаки с правого борта и первая помощь раненому радисту.
    waist_gunner: gunnerTraining('waist_gunner', [wave('trainer', 'fw190a', 2, ['beam'], 90, 300)]),
    // 8. Хвостовой стрелок: атаки сзади-сверху.
    tail_gunner: gunnerTraining('tail_gunner', [wave('trainer', 'bf109g', 3, ['high_six'], 180, 700)]),
};

export type TrainingSession = { world: MissionWorld; def: TrainingDef; state: Record<string, number>; step(): void; result(): TrainingResult };

/** Мир тренировки станции. `humanPlays` — станцию ведёт игрок, иначе ИИ (демонстрация, тесты). */
export function createTraining(options: {
    station: Station;
    config: AircraftConfig;
    content: ContentLibrary;
    mission: MissionDefinition;
    theatre: TheatreConfig;
    difficulty: Difficulty;
    skill?: Skill;
    seed?: number;
    humanPlays: boolean;
}): TrainingSession {
    const def = TRAININGS[options.station];
    const mission = def.mission(options.mission);
    const world = new MissionWorld({
        config: options.config,
        content: options.content,
        mission,
        theatre: options.theatre,
        difficulty: def.difficulty ?? options.difficulty,
        skill: options.skill,
        seed: options.seed,
        humans: options.humanPlays ? [options.station] : [],
        start: def.start(mission, options.theatre),
        aiFactory: createCrewAI,
        aiDisabled: def.aiDisabled.filter((s) => s !== options.station),
        phaseHook: def.phaseHook,
    });
    const state: Record<string, number> = {};

    def.setup?.(world);

    let finished: TrainingResult | null = null;

    return {
        world,
        def,
        state,
        step() {
            if (finished !== null) {
                return;
            }

            def.tick?.(world, state);
            world.step();

            const r = def.evaluate(world, state);

            if (r.done || world.timeS > def.timeLimitS || world.phase === 'debrief') {
                finished = def.evaluate(world, state);
                finished = { ...finished, done: true };

                if (world.phase !== 'debrief') {
                    world.end(null);
                }
            }
        },
        result() {
            return finished ?? def.evaluate(world, state);
        },
    };
}

export const TRAINING_STATIONS: Station[] = [...STATIONS];
