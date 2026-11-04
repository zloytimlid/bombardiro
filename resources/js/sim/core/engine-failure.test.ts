import { describe, expect, it } from 'vitest';
import { runningInput } from './aircraft';
import { airborneSim, flyWithAutopilot } from './testing';

/** Критерий этапа 1: отказ двигателя даёт разворачивающий момент, флюгирование его уменьшает. */
describe('engine failure', () => {
    const yawAfterFailure = (feather: boolean): { yawRate: number; heading: number } => {
        const sim = airborneSim({ altitude: 1500, speed: 80, heading: 0 });
        const input = runningInput(0.9);

        sim.run(60, input);
        sim.failEngine(1);

        if (feather) {
            input.engines[1].feather = true;
        }

        // 3 с без вмешательства пилота.
        sim.run(180, input);

        return { yawRate: sim.aircraft.omega.z, heading: sim.derived().heading };
    };

    it('yaws towards the dead (right) engine', () => {
        const { yawRate } = yawAfterFailure(false);

        expect(yawRate).toBeGreaterThan(0.01);
    });

    it('feathering the dead engine reduces the yawing moment', () => {
        const windmilling = yawAfterFailure(false);
        const feathered = yawAfterFailure(true);

        expect(feathered.yawRate).toBeGreaterThan(0);
        expect(feathered.yawRate).toBeLessThan(windmilling.yawRate * 0.9);
    });

    it('a windmilling propeller creates drag, a feathered one almost none', () => {
        const sim = airborneSim({ altitude: 1500, speed: 80 });
        const input = runningInput(0.9);

        sim.failEngine(0);
        sim.run(120, input);
        const windmill = sim.aircraft.engines[0];

        input.engines[0].feather = true;
        sim.run(120, input);
        const feathered = sim.aircraft.engines[0];

        expect(windmill.mode).toBe('failed');
        expect(windmill.thrustN).toBe(0);
        expect(windmill.propDragN).toBeGreaterThan(500);
        expect(feathered.propDragN).toBeLessThan(windmill.propDragN * 0.2);
        expect(feathered.rpm).toBeLessThan(windmill.rpm);
    });

    it('the pilot can hold heading and altitude on one engine', () => {
        const sim = airborneSim({ altitude: 1500, speed: 85, heading: 0 });

        sim.failEngine(1);
        const result = flyWithAutopilot(sim, { heading: 0, altitude: 1500, throttle: 1 }, 60, 10, (input) => {
            input.engines[1].feather = true;
        });
        const headingError = Math.abs(((sim.derived().heading + Math.PI) % (2 * Math.PI)) - Math.PI);

        expect(headingError).toBeLessThan((3 * Math.PI) / 180);
        expect(Math.abs(result.altitude - 1500)).toBeLessThan(60);
    });
});
