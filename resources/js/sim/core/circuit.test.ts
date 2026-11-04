import { describe, expect, it } from 'vitest';
import { CircuitPilot, defaultCircuit } from './ai/circuit';
import { vec } from './math';
import { DT, Simulation } from './simulation';
import { CORSICA_ALESAN, ProceduralTerrain } from './terrain';
import { b25j, loadoutForMass } from './testing';

/** Критерий этапа 1: взлёт, круг и посадка на аэродроме Алезани (без рендера). */
describe('takeoff, circuit and landing at Alesan', () => {
    it('flies a full circuit and stops on the runway', () => {
        const terrain = new ProceduralTerrain(CORSICA_ALESAN);
        const runway = CORSICA_ALESAN.runways[0]!;
        const start = vec(runway.x, runway.y - runway.length_m / 2 + 60, 0);
        const sim = new Simulation({
            config: b25j,
            terrain,
            seed: 7,
            initial: {
                position: { ...start, z: terrain.heightAt(start.x, start.y) + 2.0 },
                heading: runway.heading,
                speed: 0,
                gearDown: true,
                enginesRunning: true,
                onGround: true,
                loadout: loadoutForMass(b25j, 14500),
            },
        });
        const pilot = new CircuitPilot(defaultCircuit(runway));
        const phases: string[] = [];
        let maxAltitude = 0;

        for (let i = 0; i < 60 * 900 && pilot.phase !== 'stopped' && sim.aircraft.contact !== 'crashed'; i++) {
            const input = pilot.update(sim.aircraft, sim.derived(), DT);

            sim.step(input);
            maxAltitude = Math.max(maxAltitude, sim.aircraft.position.z);

            if (phases[phases.length - 1] !== pilot.phase) {
                phases.push(pilot.phase);
            }
        }

        const p = sim.aircraft.position;
        const along = p.y - runway.y;
        const across = p.x - runway.x;

        console.info(`phases: ${phases.join(' → ')}; touchdown vs ${sim.aircraft.touchdownVs?.toFixed(2)} m/s; stop at along ${along.toFixed(0)} across ${across.toFixed(1)}`);

        expect(sim.aircraft.contact).toBe('gear');
        expect(phases).toEqual(['takeoff_roll', 'rotate', 'climb', 'crosswind', 'downwind', 'base', 'final', 'flare', 'rollout', 'stopped']);
        expect(maxAltitude).toBeGreaterThan(runway.elevation_m + 300);
        expect(Math.abs(along)).toBeLessThan(runway.length_m / 2);
        expect(Math.abs(across)).toBeLessThan(runway.width_m / 2);
        expect(sim.aircraft.touchdownVs ?? 99).toBeLessThan(2.5);
    });
});
