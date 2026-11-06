import { describe, expect, it } from 'vitest';
import avignonJson from '../../../sim/missions/avignon.json';
import brennerJson from '../../../sim/missions/brenner.json';
import milkRunJson from '../../../sim/missions/milk-run.json';
import mtoWestJson from '../../../sim/theatres/mto-west.json';
import { createCrewAI } from './ai/crew';
import { DEFAULT_CONTENT } from './content';
import { buildDebrief } from './debrief';
import { createTerrain, GeoTerrain } from './geoTerrain';
import { vec } from './math';
import { toEnu } from './mission/geo';
import type { MissionDefinition } from './mission/schema';
import { parseMission } from './mission/schema';
import type { TheatreConfig } from './terrain';
import { CORSICA_ALESAN, parseTheatre } from './terrain';
import { b25j } from './testing';
import type { Phase } from './world';
import { MissionWorld } from './world';

/**
 * Критерии этапа 4: три миссии MVP проходятся (прогон «все 8 — ИИ» до посадки),
 * рельеф юга Франции и севера Италии, бюджет тика на самой тяжёлой миссии.
 */
const mtoWest: TheatreConfig = parseTheatre(mtoWestJson);
const missions: Record<string, MissionDefinition> = {
    'milk-run': parseMission(milkRunJson),
    avignon: parseMission(avignonJson),
    brenner: parseMission(brennerJson),
};
const theatres: Record<string, TheatreConfig> = { corsica: CORSICA_ALESAN, 'mto-west': mtoWest };

function world(slug: string, seed?: number): MissionWorld {
    const mission = missions[slug]!;
    const theatre = theatres[mission.theatre]!;

    return new MissionWorld({ config: b25j, content: DEFAULT_CONTENT, mission, theatre, difficulty: 'historical', skill: 'experienced', humans: [], seed, aiFactory: createCrewAI });
}

describe('theatre «mto-west» (Southern France, Northern Italy)', () => {
    const t0 = performance.now();
    const terrain = createTerrain(mtoWest);
    const buildMs = performance.now() - t0;
    const at = (lat: number, lon: number): { h: number; water: boolean } => {
        const p = toEnu(mtoWest, lat, lon);

        return { h: terrain.heightAt(p.x, p.y), water: terrain.isWater(p.x, p.y) };
    };

    it('is a geographic terrain built quickly enough for worker start', () => {
        const probe = (lat: number, lon: number): string => {
            const p = toEnu(mtoWest, lat, lon);
            const g = terrain as unknown as { relief: { sample(x: number, y: number): number }; coast: { sample(x: number, y: number): number } };

            return `(${lat},${lon}) relief ${g.relief.sample(p.x, p.y).toFixed(0)} coast ${g.coast.sample(p.x, p.y).toFixed(0)} h ${terrain.heightAt(p.x, p.y).toFixed(0)}`;
        };

        console.info([probe(45.83, 6.87), probe(46.0, 8.0), probe(46.45, 9.4), probe(47.005, 11.505), probe(46.14, 11.11)].join(' | '));
        console.info(`mto-west terrain built in ${buildMs.toFixed(0)} ms`);
        expect(terrain).toBeInstanceOf(GeoTerrain);
        // В одиночку ~0,6 с; при параллельном прогоне тестов — заметно дольше.
        expect(buildMs).toBeLessThan(6000);
    });

    it('keeps the Alesan runway level and puts sea, valleys and mountains where they are', () => {
        expect(at(42.2, 9.5).h).toBeCloseTo(15, 0);
        expect(at(42.2, 9.5).water).toBe(false);
        // Лигурийское море и Лионский залив.
        expect(at(43.4, 8.5).water).toBe(true);
        expect(at(42.8, 5.0).water).toBe(true);
        // Цели в низинах: Рона у Авиньона, долина Адидже у Лависа.
        expect(at(43.935, 4.795).h).toBeLessThan(150);
        expect(at(46.14, 11.11).h).toBeLessThan(600);
        // Долина По — равнина, Альпы — высокие, перевал Бреннер — седловина.
        expect(at(45.1, 9.5).h).toBeLessThan(200);
        expect(at(45.83, 6.87).h).toBeGreaterThan(2000);
        expect(at(47.005, 11.505).h).toBeLessThan(1900);
        expect(at(47.005, 11.505).h).toBeGreaterThan(800);
        // Горы Корсики к западу от Алезани.
        expect(at(42.15, 9.05).h).toBeGreaterThan(1000);
    });
});

describe('MVP missions', () => {
    for (const [slug, mission] of Object.entries(missions)) {
        it(`${slug}: loadout fits the aircraft and the route clears the terrain`, () => {
            const bombKg = mission.loadout.bombs.reduce((s, b) => s + (DEFAULT_CONTENT.bombs.find((t) => t.id === b.type)?.mass_kg.value ?? Infinity) * b.count, 0);
            const tanksKg = b25j.fuel.gameplay_tanks.value.reduce((s, t) => s + t.capacity_kg, 0);

            // 6 × 500 lb = 3000 lb — ровно предел отсека; допуск на округление килограммов.
            expect(bombKg).toBeLessThanOrEqual(b25j.bomb_bay.max_load_kg.value + 1);
            expect(mission.loadout.fuel_kg).toBeLessThanOrEqual(tanksKg);
            expect(mission.loadout.planned_burn_kg).toBeLessThan(mission.loadout.fuel_kg * 0.8);

            const theatre = theatres[mission.theatre]!;
            const terrain = createTerrain(theatre);
            const legs = mission.waypoints.filter((w) => !['takeoff', 'initial_approach', 'final', 'base'].includes(w.type));

            for (let i = 1; i < legs.length; i++) {
                const a = toEnu(theatre, legs[i - 1]!.lat, legs[i - 1]!.lon);
                const b = toEnu(theatre, legs[i]!.lat, legs[i]!.lon);
                const alt = Math.min(legs[i - 1]!.alt_m, legs[i]!.alt_m);

                for (let s = 0; s <= 40; s++) {
                    const h = terrain.heightAt(a.x + ((b.x - a.x) * s) / 40, a.y + ((b.y - a.y) * s) / 40);

                    expect(h, `${slug} ${legs[i - 1]!.id}→${legs[i]!.id}`).toBeLessThan(alt - 600);
                }
            }
        });
    }

    // Вылет опасный: зенитки и истребители иногда сбивают экипаж ИИ (пожар крыла → прыжок) — это нормально.
    // Критерий — миссия проходится: на 4 фиксированных сидах самолёт возвращается и цель поражена
    // не реже порога миссии («Бреннер» — сложная: «аллея зениток» и четвёрка Bf 109).
    const needed: Record<string, number> = { avignon: 3, brenner: 2 };

    for (const slug of ['avignon', 'brenner']) {
        it(`${slug}: all 8 stations on AI fly the mission through and mostly come home`, () => {
            const results: { outcome: string | null; target: string; phases: Phase[] }[] = [];

            for (const seed of [1, 2, 3, 4]) {
                const w = world(slug, seed);
                const phases: Phase[] = [w.phase];

                for (let i = 0; i < 60 * 60 * 60 * 4 && w.phase !== 'debrief'; i++) {
                    w.step();

                    if (phases[phases.length - 1] !== w.phase) {
                        phases.push(w.phase);
                    }
                }

                const d = buildDebrief(w);

                results.push({ outcome: w.outcome, target: d.target.status, phases });
                console.info(`${slug} seed ${seed}: ${phases.join(' → ')}; ${w.outcome}; target ${d.target.status} ${d.target.percent}%; TOT ${d.timeOverTarget.actualS} s (plan ${d.timeOverTarget.plannedS}); score ${d.score.total}`);
            }

            expect(results.every((r) => r.phases.at(-1) === 'debrief' && r.phases.includes('bomb_run'))).toBe(true);
            expect(results.filter((r) => r.outcome === 'landed' || r.outcome === 'landed_off_field' || r.outcome === 'belly_landed').length).toBeGreaterThanOrEqual(needed[slug]!);
            expect(results.filter((r) => r.target !== 'intact').length).toBeGreaterThanOrEqual(needed[slug]!);
        }, 1200000);
    }
});

describe('tick budget on the heaviest mission (Brenner)', () => {
    it('steps the busy world over the Adige valley within 4 ms', () => {
        const mission = missions.brenner!;
        const ip = mission.waypoints.find((x) => x.type === 'ip')!;
        const p = toEnu(mtoWest, ip.lat, ip.lon);
        const w = new MissionWorld({
            config: b25j,
            content: DEFAULT_CONTENT,
            mission: { ...mission, triggers: [] },
            theatre: mtoWest,
            difficulty: 'historical',
            skill: 'experienced',
            humans: [],
            aiFactory: createCrewAI,
            start: { phase: 'bomb_run', position: vec(p.x, p.y, 4200), heading: 0.15, speedMs: 98, enginesRunning: true, gearDown: false, legIndex: mission.waypoints.indexOf(ip) },
        });

        for (const wave of mission.threats.fighter_waves) {
            w.spawnWave(wave.id);
        }

        w.run(60 * 20);

        let total = 0;
        let worst = 0;
        const n = 600;

        for (let i = 0; i < n; i++) {
            const t0 = performance.now();

            w.step();

            const dt = performance.now() - t0;

            total += dt;
            worst = Math.max(worst, dt);
        }

        console.info(`brenner busy tick: avg ${(total / n).toFixed(3)} ms, worst ${worst.toFixed(2)} ms, fighters ${w.fighters.length}, flak bursts ${w.bursts.length}`);
        expect(total / n).toBeLessThan(4);
    }, 120000);
});
