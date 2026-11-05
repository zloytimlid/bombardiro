import { describe, expect, it } from 'vitest';
import { STATIONS } from './config';
import { DEFAULT_CONTENT } from './content';
import { buildDebrief } from './debrief';
import { vec } from './math';
import { parseMission } from './mission/schema';
import { CORSICA_ALESAN } from './terrain';
import { b25j, milkRun, milkRunWorld } from './testing';
import { createTraining, TRAININGS } from './training';
import type { Phase } from './world';

describe('mission format', () => {
    it('milk-run.json is a valid mission with every section of 8.3', () => {
        expect(milkRun.id).toBe('milk-run');
        expect(milkRun.placeholder).toBe(true);
        expect(milkRun.waypoints.map((w) => w.type)).toEqual(expect.arrayContaining(['takeoff', 'ip', 'target', 'rally', 'final']));
        expect(Object.keys(milkRun.briefing.roles).sort()).toEqual([...STATIONS].sort());
        expect(() => parseMission({ ...milkRun, triggers: [{ id: 'x', when: {}, then: [{ type: 'run_code', code: 'alert(1)' }] }] })).toThrow();
    });

    it('a mission refers only to known bomb, fighter and flak types', () => {
        const ids = new Set(DEFAULT_CONTENT.bombs.map((b) => b.id));

        for (const b of milkRun.loadout.bombs) {
            expect(ids.has(b.type)).toBe(true);
        }

        for (const w of milkRun.threats.fighter_waves) {
            expect(DEFAULT_CONTENT.fighters.fighters.some((f) => f.id === w.type)).toBe(true);
        }

        expect(milkRun.loadout.bombs.reduce((s, b) => s + b.count * 226.8, 0)).toBeLessThanOrEqual(b25j.bomb_bay.max_load_kg.value);
    });
});

/**
 * Критерий этапа 2: ИИ на любой станции сам выполняет её задачи;
 * прогон «все 8 — ИИ» проходит «Милк-ран» от запуска до посадки.
 */
describe('Milk Run with all 8 stations on AI', () => {
    it('flies every phase and lands', () => {
        const world = milkRunWorld({ seed: 1944 });
        const phases: Phase[] = [world.phase];

        for (let i = 0; i < 60 * 60 * 80 && world.phase !== 'debrief'; i++) {
            world.step();

            if (phases[phases.length - 1] !== world.phase) {
                phases.push(world.phase);
            }
        }

        const debrief = buildDebrief(world);

        console.info(`all-AI: ${phases.join(' → ')}; outcome ${world.outcome}; score ${debrief.score.total}; target ${debrief.target.status} ${debrief.target.percent}%`);

        expect(phases).toEqual(['preflight', 'takeoff', 'formup', 'route', 'bomb_run', 'egress', 'return', 'landing', 'debrief']);
        expect(world.outcome).toBe('landed');
        expect(world.aircraft.touchdownVs ?? 99).toBeLessThan(3);

        // Каждая станция сделала свою работу.
        expect(world.events.some((e) => e.type === 'bombs_released')).toBe(true);
        expect(world.impacts.length).toBe(4);
        expect(debrief.target.status).not.toBe('intact');
        expect(world.checklists.start.left_engine && world.checklists.start.right_engine).toBe(true);
        expect(world.nav.errorAtIpM).not.toBeNull();
        expect(world.radio.received.length).toBeGreaterThan(0);
        expect(world.radio.iff).toBe(true);
        expect(world.crew.intercom.length + world.events.length).toBeGreaterThan(20);
        expect(debrief.timeOverTarget.withinWindow).toBe(true);
        expect(debrief.score.total).toBeGreaterThan(60);
        expect(debrief.track.length).toBeGreaterThan(100);
    }, 180000);
});

describe('world', () => {
    const start = { phase: 'route' as const, position: vec(50000, 30000, 3000), heading: 1.5, speedMs: 98, enginesRunning: true, gearDown: false, legIndex: 3 };

    it('is deterministic for the same seed', () => {
        const a = milkRunWorld({ seed: 5, start });
        const b = milkRunWorld({ seed: 5, start });
        const c = milkRunWorld({ seed: 6, start });

        for (const w of [a, b, c]) {
            w.spawnWave('bf109-pair');
            w.run(60 * 40);
        }

        expect(a.stateHash()).toBe(b.stateHash());
        expect(a.stateHash()).not.toBe(c.stateHash());
    });

    it('time acceleration is allowed on the route only without threats nearby', () => {
        const w = milkRunWorld({ start });

        w.run(10);
        expect(w.canAccelerate()).toBe(true);

        w.spawnWave('bf109-pair');
        expect(w.canAccelerate()).toBe(false);
    });

    it('a pilot order to lower the gear is executed by the AI copilot after a reaction delay', () => {
        const w = milkRunWorld({ humans: ['pilot'], start });

        w.act('pilot', { type: 'gear', down: true });
        expect(w.copilot.gearDown).toBe(false);
        w.run(60 * 3);
        expect(w.copilot.gearDown).toBe(true);
        expect(w.crew.intercom.some((m) => m.key === 'intercom.order_gear_down')).toBe(true);
    });

    it('a bail-out order: AI jumps after 2–5 s, the human presses Jump', () => {
        const w = milkRunWorld({ humans: ['tail_gunner'], start });

        w.act('pilot', { type: 'order', order: 'bailout' });
        w.run(60 * 6);
        expect(w.member('copilot').bailedOut).toBe(true);
        expect(w.member('tail_gunner').bailedOut).toBe(false);

        w.act('tail_gunner', { type: 'jump' });
        w.run(2);
        expect(w.phase).toBe('debrief');
        expect(w.outcome).toBe('bailed_out');
    });

    it('a crash ends the sortie with a debrief', () => {
        const w = milkRunWorld({ humans: [...STATIONS], start: { ...start, position: vec(50000, 30000, 200) } });

        w.pilot.pitch = -1;
        w.run(60 * 60);
        expect(w.outcome).toBe('crashed');
        expect(buildDebrief(w).score.parts.aircraft).toBe(0);
    });
});

/** Бюджет тика ядра (раздел 7.4): 1 бомбардировщик, 12 ИИ-самолётов, 6 батарей, ~200 снарядов — ≤ 4 мс. */
describe('tick budget', () => {
    it('steps the busy world within 4 ms', () => {
        const at = { x: 60000, y: 31000 };
        const origin = { origin_lat: CORSICA_ALESAN.origin_lat, origin_lon: CORSICA_ALESAN.origin_lon };
        const k = Math.cos((origin.origin_lat * Math.PI) / 180);
        const flak = Array.from({ length: 6 }, (_, i) => ({
            id: `b${i}`,
            type: 'heavy' as const,
            lat: origin.origin_lat + (at.y + (i - 3) * 1500) / 110574,
            lon: origin.origin_lon + (at.x + 3000) / (111320 * k),
            elevation_m: 0,
            guns: 4,
            active: true,
            barrage: false,
        }));
        const mission = {
            ...milkRun,
            formation: { wingmen: 2, spacing_m: 70 },
            triggers: [],
            threats: {
                flak,
                fighter_waves: [
                    { id: 'a', type: 'bf109g', count: 8, skill: 'veteran' as const, spawn: { bearing_deg: 0, distance_m: 3000, altitude_offset_m: 200 }, attacks: ['head_on' as const, 'beam' as const] },
                    { id: 'b', type: 'fw190a', count: 4, skill: 'veteran' as const, spawn: { bearing_deg: 180, distance_m: 2500, altitude_offset_m: 400 }, attacks: ['high_six' as const] },
                ],
            },
        };
        const world = milkRunWorld({ mission, start: { phase: 'route', position: vec(at.x, at.y, 3000), heading: 1.5, speedMs: 98, enginesRunning: true, gearDown: false, legIndex: 3 } });

        world.spawnWave('a');
        world.spawnWave('b');
        world.run(60 * 25);

        let worst = 0;
        let total = 0;
        let maxBullets = 0;
        const n = 600;

        for (let i = 0; i < n; i++) {
            const t0 = performance.now();

            world.step();

            const dt = performance.now() - t0;

            total += dt;
            worst = Math.max(worst, dt);
            maxBullets = Math.max(maxBullets, world.bullets.length + world.bursts.length);
        }

        console.info(`busy tick: avg ${(total / n).toFixed(3)} ms, worst ${worst.toFixed(2)} ms, aircraft ${1 + world.fighters.length + world.wingmen.length}, projectiles ${maxBullets}`);

        expect(world.fighters.length + world.wingmen.length).toBeGreaterThanOrEqual(12);
        expect(total / n).toBeLessThan(4);
    }, 60000);
});

/** Критерий этапа 2: у каждой из 8 станций есть тренировка с оценкой. */
describe('station trainings', () => {
    for (const station of STATIONS) {
        it(`${station}: the AI completes the training and gets a score`, () => {
            expect(TRAININGS[station]).toBeDefined();

            const session = createTraining({ station, config: b25j, content: DEFAULT_CONTENT, mission: milkRun, theatre: CORSICA_ALESAN, difficulty: 'training', seed: 5, humanPlays: false });

            for (let i = 0; i < 60 * 1000 && !session.result().done; i++) {
                session.step();
            }

            const result = session.result();

            expect(result.done).toBe(true);
            expect(result.score).toBeGreaterThan(30);
            expect(result.score).toBeLessThanOrEqual(100);
            expect(result.metrics.length).toBeGreaterThan(1);
        }, 120000);
    }

    it('a human who does nothing scores low', () => {
        const session = createTraining({ station: 'radio', config: b25j, content: DEFAULT_CONTENT, mission: milkRun, theatre: CORSICA_ALESAN, difficulty: 'training', seed: 5, humanPlays: true });

        session.world.act('radio', { type: 'radio_dial', mhz: 3.2 });

        for (let i = 0; i < 60 * 300 && !session.result().done; i++) {
            session.step();
        }

        expect(session.result().score).toBeLessThan(20);
    }, 60000);
});
