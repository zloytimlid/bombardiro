import { describe, expect, it } from 'vitest';
import type { AircraftInput } from './aircraft';
import { runningInput } from './aircraft';
import { Rng } from './rng';
import { Simulation } from './simulation';
import { CORSICA_ALESAN, ProceduralTerrain } from './terrain';
import { b25j, loadoutForMass } from './testing';

/** Критерий этапа 1: одинаковые seed + запись ввода → одинаковый хэш состояния. */
const recordInputs = (seed: number, ticks: number): AircraftInput[] => {
    const rng = new Rng(seed);
    const inputs: AircraftInput[] = [];

    for (let i = 0; i < ticks; i++) {
        const input = runningInput(0.8);

        input.pitch = Math.sin(i / 90) * 0.3 + rng.range(-0.05, 0.05);
        input.roll = Math.sin(i / 140) * 0.4;
        input.yaw = rng.range(-0.1, 0.1);
        inputs.push(input);
    }

    return inputs;
};

const replay = (seed: number, inputs: AircraftInput[], turbulence = 2): Simulation => {
    const sim = new Simulation({
        config: b25j,
        terrain: new ProceduralTerrain(CORSICA_ALESAN),
        seed,
        weather: { wind: [{ altitude_m: 0, from_deg: 270, speed_ms: 6 }, { altitude_m: 3000, from_deg: 300, speed_ms: 18 }], turbulence_ms: turbulence },
        initial: {
            position: { x: 0, y: 0, z: 1200 },
            heading: 0.3,
            speed: 85,
            gearDown: false,
            enginesRunning: true,
            loadout: loadoutForMass(b25j, 14500),
        },
    });

    for (const input of inputs) {
        sim.step(input);
    }

    return sim;
};

describe('determinism', () => {
    const inputs = recordInputs(99, 60 * 60);

    it('same seed and recorded input give the same state hash', () => {
        const a = replay(42, inputs);
        const b = replay(42, inputs);

        expect(a.tick).toBe(3600);
        expect(a.stateHash()).toBe(b.stateHash());
    });

    it('a different seed changes the state (turbulence is seeded)', () => {
        expect(replay(42, inputs).stateHash()).not.toBe(replay(43, inputs).stateHash());
    });

    it('a single changed input changes the state', () => {
        // Рули ограничены по скорости отклонения, поэтому меняем РУД на один тик.
        const changed = inputs.map((input, i) => {
            if (i !== 100) {
                return input;
            }

            const copy = runningInput(0.5);

            return { ...input, engines: copy.engines };
        });

        expect(replay(42, inputs).stateHash()).not.toBe(replay(42, changed).stateHash());
    });

    it('a tick stays within the 4 ms budget', () => {
        const sim = replay(1, []);
        const input = runningInput(0.8);
        const started = performance.now();

        sim.run(600, input);
        const perTickMs = (performance.now() - started) / 600;

        expect(perTickMs).toBeLessThan(4);
    });
});
