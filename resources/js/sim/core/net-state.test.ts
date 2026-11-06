import { describe, expect, it } from 'vitest';
import { STATIONS } from './config';
import { DEFAULT_CONTENT, fighterType } from './content';
import { createFighter } from './fighters';
import { add, scale, vec } from './math';
import { milkRun, milkRunWorld } from './testing';
import { MAX_LAG_TICKS } from './world';

const start = { phase: 'route' as const, position: vec(50000, 30000, 3000), heading: 1.5, speedMs: 98, enginesRunning: true, gearDown: false, legIndex: 3 };

describe('world snapshot for host migration (section 9.3)', () => {
    it('a restored world continues exactly like the original when nobody is AI-driven', () => {
        // Без ИИ (все места — «игроки» без ввода) состояние мира полностью в снапшоте.
        const a = milkRunWorld({ seed: 3, humans: [...STATIONS], start });

        a.pilot.throttle = [0.8, 0.8];
        a.spawnWave('bf109-pair');
        a.run(60 * 20);

        const state = JSON.parse(JSON.stringify(a.exportState())) as ReturnType<typeof a.exportState>;
        const b = milkRunWorld({ seed: 3, humans: [...STATIONS], start });

        b.restoreState(state);

        // Снаряды в снапшот не входят — уберём их и у оригинала, чтобы сравнить продолжение.
        a.bullets = [];
        a.run(60 * 10);
        b.run(60 * 10);

        expect(b.tick).toBe(a.tick);
        expect(b.stateHash()).toBe(a.stateHash());
        expect(b.events.length).toBe(a.events.length);
    });

    it('an AI crew picks up from a snapshot mid-mission and keeps flying', () => {
        const a = milkRunWorld({ seed: 1944 });

        a.run(60 * 400);

        const b = milkRunWorld({ seed: 1944 });

        b.restoreState(a.exportState());
        expect(b.phase).toBe(a.phase);
        expect(b.nav.legIndex).toBe(a.nav.legIndex);

        b.run(60 * 120);
        expect(b.aircraft.contact).toBe('air');
        expect(b.derived().altitude).toBeGreaterThan(1000);
    }, 60000);

    it('the full snapshot is plain JSON', () => {
        const w = milkRunWorld({ start });

        w.spawnWave('bf109-pair');
        w.run(600);

        const json = JSON.stringify(w.exportState());

        expect(json.length).toBeGreaterThan(1000);
        expect(json).not.toContain('Infinity');
    });
});

describe('lag compensation (section 9.1)', () => {
    it('caps the rewind at 150 ms', () => {
        const w = milkRunWorld({ start });

        w.setStationLag('tail_gunner', 1000);
        expect(w.stationLagTicks.tail_gunner).toBe(MAX_LAG_TICKS);
        expect(MAX_LAG_TICKS).toBe(9);

        w.setStationLag('waist_gunner', 100);
        expect(w.stationLagTicks.waist_gunner).toBe(3);
    });

    it('a delayed gunner hits where the fighter was when he aimed, not where it is now', () => {
        const run = (lagMs: number): number => {
            const w = milkRunWorld({ humans: [...STATIONS], start, mission: { ...milkRun, triggers: [] } });
            const type = fighterType(DEFAULT_CONTENT, 'bf109g');
            const fighter = createFighter(999, type, 'test', 'novice', add(w.aircraft.position, vec(0, 0, 600)), vec(150, 0, 0), ['beam'], 1);

            fighter.phase = 'leave';
            w.fighters.push(fighter);
            w.run(20);

            // Стрелок видел цель на 150 мс раньше: пуля идёт через ту точку траектории.
            const f = w.fighters[0]!;
            const seen = w.fighterPositionAt(f, MAX_LAG_TICKS - 1);
            const hp = f.hp;

            w.setStationLag('top_gunner', lagMs);
            w.bullets.push({ id: 1, owner: 'bomber', mount: 'top_turret', position: add(seen, vec(0, 0, -5)), velocity: vec(0, 0, 900), ageS: 0, tracer: false, damage: 1, lagTicks: w.stationLagTicks.top_gunner ?? 0 });
            w.step();

            return hp - (w.fighters[0]?.hp ?? hp);
        };

        expect(run(300)).toBeGreaterThan(0);
        expect(run(0)).toBe(0);
        expect(scale(vec(1, 0, 0), 2).x).toBe(2);
    });
});
