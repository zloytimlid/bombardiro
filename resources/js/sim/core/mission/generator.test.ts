import { describe, expect, it } from 'vitest';
import milkRunJson from '../../../../sim/missions/milk-run.json';
import mtoWestJson from '../../../../sim/theatres/mto-west.json';
import { createCrewAI } from '../ai/crew';
import { DEFAULT_CONTENT } from '../content';
import { buildDebrief } from '../debrief';
import { createTerrain } from '../geoTerrain';
import { parseTheatre } from '../terrain';
import { b25j } from '../testing';
import type { Phase } from '../world';
import { MissionWorld } from '../world';
import type { GeneratorOptions } from './generator';
import { generateMission } from './generator';
import { toEnu } from './geo';
import { parseMission } from './schema';

const theatre = parseTheatre(mtoWestJson);
const base = parseMission(milkRunJson);
const pool = mtoWestJson.generator as unknown as Pick<GeneratorOptions, 'targets' | 'flakZones'> & { flak_zones: GeneratorOptions['flakZones'] };
const opts = (seed: number, extra: Partial<GeneratorOptions> = {}): GeneratorOptions => ({ seed, difficulty: 'normal', month: 8, targets: pool.targets, flakZones: pool.flak_zones, ...extra });

describe('mission generator (section 8.5)', () => {
    it('builds a valid, repeatable mission from the theatre pool', () => {
        const a = generateMission(theatre, base, opts(42));
        const b = generateMission(theatre, base, opts(42));
        const c = generateMission(theatre, base, opts(43));

        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
        expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
        expect(pool.targets.map((t) => t.id)).toContain(a.target.id);
        expect(a.waypoints.filter((w) => w.type === 'ip')).toHaveLength(1);
        expect(a.waypoints.at(-1)?.type).toBe('base');
    });

    it('keeps the route clear of the terrain and away from known flak zones before the IP', () => {
        const terrain = createTerrain(theatre);

        for (const seed of [1, 2, 3, 4, 5, 6]) {
            const m = generateMission(theatre, base, opts(seed));
            const legs = m.waypoints.filter((w) => !['takeoff', 'initial_approach', 'final', 'base'].includes(w.type));
            const ipIndex = legs.findIndex((w) => w.type === 'ip');

            for (let i = 1; i < legs.length; i++) {
                const a = toEnu(theatre, legs[i - 1]!.lat, legs[i - 1]!.lon);
                const b = toEnu(theatre, legs[i]!.lat, legs[i]!.lon);
                const alt = Math.min(legs[i - 1]!.alt_m, legs[i]!.alt_m);

                for (let s = 0; s <= 30; s++) {
                    const x = a.x + ((b.x - a.x) * s) / 30;
                    const y = a.y + ((b.y - a.y) * s) / 30;

                    expect(terrain.heightAt(x, y), `seed ${seed} ${legs[i - 1]!.id}→${legs[i]!.id}`).toBeLessThan(alt - 500);

                    // До IP маршрут не заходит в центр известных зон ПВО (кроме зоны самой цели).
                    if (i <= ipIndex) {
                        for (const z of pool.flak_zones) {
                            const c = toEnu(theatre, z.lat, z.lon);
                            const nearTarget = Math.hypot(c.x - toEnu(theatre, m.target.aim_point.lat, m.target.aim_point.lon).x, c.y - toEnu(theatre, m.target.aim_point.lat, m.target.aim_point.lon).y) < 60000;

                            if (!nearTarget) {
                                expect(Math.hypot(x - c.x, y - c.y), `seed ${seed} near ${z.id}`).toBeGreaterThan(z.radius_m * 0.5);
                            }
                        }
                    }
                }
            }
        }
    });

    it('scales threats with difficulty', () => {
        const training = generateMission(theatre, base, opts(7, { difficulty: 'training' }));
        const hard = generateMission(theatre, base, opts(7, { difficulty: 'hard' }));

        expect(training.threats.fighter_waves).toHaveLength(0);
        expect(hard.threats.fighter_waves[0]?.count).toBe(4);
    });

    it('a generated sortie is flown through by the all-AI crew', () => {
        const mission = generateMission(theatre, base, opts(11, { targetId: 'var-bridge', difficulty: 'training' }));
        const w = new MissionWorld({ config: b25j, content: DEFAULT_CONTENT, mission, theatre, difficulty: 'historical', skill: 'experienced', humans: [], seed: 11, aiFactory: createCrewAI });
        const phases: Phase[] = [w.phase];

        for (let i = 0; i < 60 * 60 * 60 * 4 && w.phase !== 'debrief'; i++) {
            w.step();

            if (phases.at(-1) !== w.phase) {
                phases.push(w.phase);
            }
        }

        const d = buildDebrief(w);

        console.info(`generated ${mission.target.id}: ${phases.join(' → ')}; ${w.outcome}; target ${d.target.status}; TOT ${d.timeOverTarget.actualS} (plan ${d.timeOverTarget.plannedS})`);
        expect(phases).toContain('bomb_run');
        expect(['landed', 'landed_off_field', 'belly_landed']).toContain(w.outcome);
    }, 600000);
});
