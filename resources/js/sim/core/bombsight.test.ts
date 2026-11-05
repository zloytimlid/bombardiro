import { describe, expect, it } from 'vitest';
import { buildBallisticTable, fallSolution, lookupBallistics } from './ballistics';
import { activateSight, createBombsight, readSight, releaseRange, shouldRelease, syncPerfect, toTrackFrame } from './bombsight';
import { bombType, DEFAULT_CONTENT } from './content';
import type { MissionDefinition } from './mission/schema';
import { DT } from './simulation';
import { FlatTerrain } from './terrain';
import { milkRun, milkRunWorld } from './testing';

const AN_M64 = bombType(DEFAULT_CONTENT, 'AN-M64');

/** Миссия без ветра и угроз: только самолёт, прицел и одна бомба. */
const calm: MissionDefinition = {
    ...milkRun,
    weather: { ...milkRun.weather, wind: [], turbulence_ms: 0 },
    threats: { flak: [], fighter_waves: [] },
    triggers: [],
    formation: { wingmen: 0, spacing_m: 70 },
    target: { ...milkRun.target, elevation_m: 0 },
};

describe('bomb ballistics', () => {
    it('without drag matches the vacuum solution', () => {
        const vacuum = { ...AN_M64, gameplay: { ...AN_M64.gameplay, value: { ...AN_M64.gameplay.value, cd: 1e-9 } } };
        const s = fallSolution(vacuum, 4000, 0, 100, 0.005);

        expect(s.timeS).toBeCloseTo(Math.sqrt((2 * 4000) / 9.80665), 1);
        expect(s.trailM).toBeLessThan(1);
    });

    it('drag makes the bomb fall longer and lag behind the aircraft', () => {
        const s = fallSolution(AN_M64, 4000, 0, 100);

        expect(s.timeS).toBeGreaterThan(28.6);
        expect(s.trailM).toBeGreaterThan(20);
        expect(s.trailM).toBeLessThan(400);
    });

    it('the sight table interpolates the direct solution', () => {
        const table = buildBallisticTable(AN_M64);
        const direct = fallSolution(AN_M64, 3200, 0, 97);
        const looked = lookupBallistics(table, 3200, 97);

        expect(Math.abs(looked.timeS - direct.timeS)).toBeLessThan(0.15);
        expect(Math.abs(looked.trailM - direct.trailM)).toBeLessThan(6);
    });
});

describe('bombsight', () => {
    it('release range shrinks as the target approaches and the sight drops at the right moment', () => {
        const table = buildBallisticTable(AN_M64);
        const sight = createBombsight();

        syncPerfect(sight, { heightAboveTarget: 4000, tas: 100, groundVelocity: { x: 0, y: 100 }, heading: 0, toTarget: { x: 0, y: 6000 } });

        const range = releaseRange(sight, table).rangeM;

        expect(range).toBeGreaterThan(2500);
        expect(shouldRelease(sight, table, 0, 0)).toBe(false);

        sight.aim = { x: 0, y: range - 1 };
        expect(shouldRelease(sight, table, 0, 0)).toBe(true);
    });

    it('PDI points to the side of the aiming point', () => {
        const table = buildBallisticTable(AN_M64);
        const sight = createBombsight();

        activateSight(sight, 0, 8000);
        sight.aim = { x: 400, y: 8000 };

        expect(readSight(sight, table, 0, null).pdi).toBeGreaterThan(0);

        sight.aim = { x: -400, y: 8000 };
        expect(readSight(sight, table, 0, null).pdi).toBeLessThan(0);
    });

    it('track frame decomposition is consistent', () => {
        const v = toTrackFrame({ x: 100, y: 0 }, Math.PI / 2);

        expect(v.along).toBeCloseTo(100);
        expect(v.across).toBeCloseTo(0);
    });

    /**
     * Критерий этапа 2: сброс по прицелу без ветра с 4000 м — промах ≤ 30 м
     * при идеальной синхронизации (юнит-тест баллистики).
     */
    it('drop from 4000 m without wind with perfect synchronisation misses by 30 m or less', () => {
        const target = milkRunWorld({ mission: calm }).target.aim;
        const world = milkRunWorld({
            mission: calm,
            seed: 3,
            terrain: new FlatTerrain(0),
            humans: ['copilot', 'bombardier', 'navigator', 'top_gunner', 'radio', 'waist_gunner', 'tail_gunner'],
            start: {
                phase: 'bomb_run',
                position: { x: target.x, y: target.y - 9000, z: 4000 },
                heading: 0,
                speedMs: 100,
                enginesRunning: true,
                gearDown: false,
                legIndex: calm.waypoints.findIndex((w) => w.type === 'target'),
                bombs: [{ type: 'AN-M64', count: 1 }],
            },
        });

        world.act('bombardier', { type: 'release_mode', mode: 'salvo' });
        world.act('bombardier', { type: 'arm', on: true });
        world.act('bombardier', { type: 'doors', open: true });

        for (let i = 0; i < 60 * 120 && world.impacts.length === 0; i++) {
            const a = world.aircraft;
            const d = world.derived();

            // Идеальная синхронизация: оценки прицела = истина каждый тик.
            syncPerfect(world.sight, {
                heightAboveTarget: d.altitude - world.target.aim.z,
                tas: d.trueAirspeed,
                groundVelocity: { x: a.velocity.x, y: a.velocity.y },
                heading: d.heading,
                toTarget: { x: world.target.aim.x - a.position.x, y: world.target.aim.y - a.position.y },
            });
            world.step();
        }

        const impact = world.impacts[0];

        expect(impact).toBeDefined();
        console.info(`perfect-sync miss: ${impact?.missM.toFixed(1)} m after ${world.timeS.toFixed(0)} s`);
        expect(impact?.missM ?? Infinity).toBeLessThanOrEqual(30);
        expect(DT).toBeCloseTo(1 / 60);
    });

    it('an AI bombardier with sync errors still hits close to the bridge in wind', () => {
        const world = milkRunWorld({ seed: 11, mission: { ...milkRun, threats: { flak: [], fighter_waves: [] }, triggers: [] } });
        const target = world.target.aim;
        const ip = world.waypoint('ip')?.position ?? target;
        const dx = target.x - ip.x;
        const dy = target.y - ip.y;
        const len = Math.hypot(dx, dy);
        const run = milkRunWorld({
            seed: 11,
            mission: { ...milkRun, threats: { flak: [], fighter_waves: [] }, triggers: [], formation: { wingmen: 0, spacing_m: 70 } },
            start: {
                phase: 'bomb_run',
                position: { x: target.x - (dx / len) * 14000, y: target.y - (dy / len) * 14000, z: 3000 },
                heading: Math.atan2(dx, dy),
                speedMs: 98,
                enginesRunning: true,
                gearDown: false,
                legIndex: milkRun.waypoints.findIndex((w) => w.type === 'target'),
            },
        });

        run.act('bombardier', { type: 'arm', on: true });

        for (let i = 0; i < 60 * 300 && run.phase === 'bomb_run'; i++) {
            run.step();
        }

        const misses = run.impacts.map((i) => i.missM);

        expect(misses).toHaveLength(4);
        expect(Math.max(...misses)).toBeLessThan(120);
        expect(run.targetResult().status).not.toBe('intact');
    });
});
