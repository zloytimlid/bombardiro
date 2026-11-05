import { describe, expect, it } from 'vitest';
import { segmentSphere, stepBullet } from './ballistics';
import { DEFAULT_CONTENT, fighterType, flakType } from './content';
import { createFighter, stepFighter } from './fighters';
import type { FighterPhase } from './fighters';
import type { FlakBattery } from './flak';
import { errorFor, expectedFragments, poisson, stepBattery } from './flak';
import { azElOf, clampToArc, createMounts, inNoFireZone, leadDirection, mountDirectionBody, stepMount } from './guns';
import { add, length, scale, sub, vec } from './math';
import { Rng } from './rng';
import { airborneSim, b25j } from './testing';

const gun = DEFAULT_CONTENT.gun;
const mounts = b25j.gameplay_mounts.value;
const DEG = Math.PI / 180;

describe('gun mounts', () => {
    it('every configured gun has a mount with a sector', () => {
        const states = createMounts(b25j, gun);

        expect(states).toHaveLength(b25j.guns.length);

        for (const g of b25j.guns) {
            expect(mounts[g.id]).toBeDefined();
        }

        expect(states.reduce((s, m) => s + m.guns, 0)).toBe(12);
    });

    it('a tail mount cannot swing to the nose and the top turret cannot shoot its own tail fins', () => {
        const tail = mounts.tail;
        const top = mounts.top_turret;

        expect(tail && Math.abs(clampToArc(tail, 0, 0).az)).toBeGreaterThan(2);
        expect(top && inNoFireZone(top, Math.PI, 5 * DEG)).toBe(true);
        expect(top && inNoFireZone(top, Math.PI, 40 * DEG)).toBe(false);
    });

    it('azimuth/elevation round-trip through the body direction', () => {
        const d = mountDirectionBody(0.7, 0.3);
        const back = azElOf(d);

        expect(back.az).toBeCloseTo(0.7);
        expect(back.el).toBeCloseTo(0.3);
    });

    it('slews at the mount rate, spends ammo, heats up and jams; holding the key clears the jam', () => {
        const sim = airborneSim({ altitude: 3000, speed: 95 });
        const [state] = createMounts(b25j, gun).filter((m) => m.id === 'top_turret');
        const cfg = mounts.top_turret;
        const rng = new Rng(4);
        const bullets: unknown[] = [];

        if (!state || !cfg) {
            throw new Error('top turret missing');
        }

        stepMount(state, cfg, { az: Math.PI / 2, el: 0.3, fire: false, clearJam: false }, gun, sim.aircraft, rng, 0.1, (b) => bullets.push(b));
        expect(state.az).toBeCloseTo(cfg.slew_deg_s * DEG * 0.1, 3);

        const ammo = state.ammo;
        let maxHeat = 0;
        let jams = 0;

        // Длинная очередь: ствол перегревается, задержки учащаются.
        for (let i = 0; i < 60 * 25; i++) {
            if (state.jammed) {
                jams++;
                state.jammed = false;
            }

            stepMount(state, cfg, { az: Math.PI / 2, el: 0.3, fire: true, clearJam: false }, gun, sim.aircraft, rng, 1 / 60, (b) => bullets.push(b));
            maxHeat = Math.max(maxHeat, state.heat);
        }

        expect(state.ammo).toBeLessThan(ammo);
        expect(bullets.length).toBe(state.shotsFired - jams);
        expect(maxHeat).toBeGreaterThan(gun.gameplay.value.overheat);
        expect(jams).toBeGreaterThan(0);

        state.jammed = true;

        for (let i = 0; i < 60 * 3; i++) {
            stepMount(state, cfg, { az: Math.PI / 2, el: 0.3, fire: false, clearJam: true }, gun, sim.aircraft, rng, 1 / 60, () => undefined);
        }

        expect(state.jammed).toBe(false);
    });

    it('lead direction meets a crossing target', () => {
        const rel = vec(600, 0, 0);
        const vel = vec(0, 120, 0);
        const lead = leadDirection(rel, vel, 820);

        expect(lead).not.toBeNull();

        if (lead) {
            const bullet = scale(lead.dir, 820 * lead.timeS);
            const target = add(rel, scale(vel, lead.timeS));

            expect(length(sub(bullet, target))).toBeLessThan(1);
        }
    });

    it('bullets slow down and drop; a segment test catches a fast bullet passing a sphere', () => {
        const bullet = { id: 1, owner: 'bomber' as const, mount: 'tail', position: vec(0, 0, 1000), velocity: vec(887, 0, 0), ageS: 0, tracer: false, damage: 1 };

        for (let i = 0; i < 60; i++) {
            stepBullet(bullet, gun.gameplay.value.drag_k_per_m, 1 / 60);
        }

        expect(length(bullet.velocity)) .toBeLessThan(887);
        expect(bullet.position.z).toBeLessThan(1000);
        expect(segmentSphere(vec(-10, 0, 0), vec(10, 0, 0), vec(), 1)).not.toBeNull();
        expect(segmentSphere(vec(-10, 5, 0), vec(10, 5, 0), vec(), 1)).toBeNull();
    });
});

describe('flak', () => {
    const heavy = flakType(DEFAULT_CONTENT, 'heavy');
    const battery = (): FlakBattery => ({
        id: 'b',
        typeId: 'heavy',
        position: vec(0, 0, 0),
        guns: 2,
        active: true,
        barrage: false,
        cooldownS: 0,
        trackingS: 0,
        refHeading: null,
        refAltitude: null,
        refTimerS: 0,
        shots: 0,
    });

    it('error shrinks while the target holds course and resets on a manoeuvre', () => {
        const b = battery();
        const rng = new Rng(1);
        let id = 1;
        const target = { position: vec(2000, 0, 3000), velocity: vec(0, 95, 0), heading: 0 };

        for (let i = 0; i < 60 * 40; i++) {
            stepBattery(b, heavy, target, null, rng, i, 60, 1 / 60, () => id++);
        }

        expect(errorFor(heavy, b.trackingS)).toBeCloseTo(heavy.min_error_m);

        const turned = { ...target, heading: 0.5 };

        for (let i = 0; i < 60 * 5; i++) {
            stepBattery(b, heavy, turned, null, rng, i, 60, 1 / 60, () => id++);
        }

        expect(b.trackingS).toBeLessThan(10);
    });

    it('bursts come after the shell time of flight; close bursts throw more fragments', () => {
        const b = battery();
        const bursts = stepBattery(b, heavy, { position: vec(3000, 0, 3000), velocity: vec(0, 95, 0), heading: 0 }, null, new Rng(2), 100, 60, 1 / 60, () => 1);

        expect(bursts).toHaveLength(2);
        expect(bursts[0]?.tick).toBeGreaterThan(100 + 60 * 5);
        expect(expectedFragments(heavy, 15)).toBeGreaterThan(expectedFragments(heavy, 60));
        expect(expectedFragments(heavy, heavy.lethal_radius_m + 1)).toBe(0);

        const rng = new Rng(9);
        let total = 0;

        for (let i = 0; i < 2000; i++) {
            total += poisson(rng, 2.5);
        }

        expect(total / 2000).toBeCloseTo(2.5, 0);
    });

    it('a battery out of range or reach does not fire', () => {
        const light = flakType(DEFAULT_CONTENT, 'light');
        const b = { ...battery(), typeId: 'light' as const };

        expect(stepBattery(b, light, { position: vec(500, 0, 3000), velocity: vec(0, 95, 0), heading: 0 }, null, new Rng(3), 0, 60, 1 / 60, () => 1)).toHaveLength(0);
    });
});

describe('fighters', () => {
    it('go through approach → attack → break and fire at the bomber', () => {
        const type = fighterType(DEFAULT_CONTENT, 'bf109g');
        const f = createFighter(1, type, 'w', 'veteran', vec(0, -7000, 3600), vec(0, 125, 0), ['high_six'], 1);
        const rng = new Rng(5);
        const bomber = { position: vec(0, 0, 3000), velocity: vec(0, 95, 0), inCloud: false };
        const phases = new Set<FighterPhase>();
        let bullets = 0;

        for (let i = 0; i < 60 * 150; i++) {
            bomber.position = add(bomber.position, scale(bomber.velocity, 1 / 60));
            stepFighter(f, { config: DEFAULT_CONTENT.fighters, type, target: bomber, groundAt: () => 0, rng, dt: 1 / 60, spawnBullet: () => bullets++ });
            phases.add(f.phase);
        }

        expect(phases.has('approach')).toBe(true);
        expect(phases.has('attack')).toBe(true);
        expect(phases.has('break')).toBe(true);
        expect(bullets).toBeGreaterThan(5);
        expect(f.passes).toBeGreaterThan(0);
    });

    it('a shot-down fighter falls and is removed at the ground', () => {
        const type = fighterType(DEFAULT_CONTENT, 'fw190a');
        const f = createFighter(2, type, 'w', 'novice', vec(0, 0, 500), vec(0, 120, -20), ['beam'], 1);

        f.hp = 0;

        for (let i = 0; i < 60 * 60 && !f.removed; i++) {
            stepFighter(f, { config: DEFAULT_CONTENT.fighters, type, target: { position: vec(0, 5000, 3000), velocity: vec(), inCloud: false }, groundAt: () => 0, rng: new Rng(1), dt: 1 / 60, spawnBullet: () => undefined });
        }

        expect(f.phase).toBe('down');
        expect(f.removed).toBe(true);
    });

    it('clouds hide the bomber from patrolling fighters', () => {
        const type = fighterType(DEFAULT_CONTENT, 'bf109g');
        const run = (inCloud: boolean): FighterPhase => {
            const f = createFighter(3, type, 'w', 'veteran', vec(6000, 0, 3000), vec(0, 125, 0), ['beam'], 1);

            for (let i = 0; i < 60 * 5; i++) {
                stepFighter(f, { config: DEFAULT_CONTENT.fighters, type, target: { position: vec(), velocity: vec(0, 95, 0), inCloud }, groundAt: () => 0, rng: new Rng(1), dt: 1 / 60, spawnBullet: () => undefined });
            }

            return f.phase;
        };

        expect(run(false)).toBe('approach');
        expect(run(true)).toBe('patrol');
    });
});
