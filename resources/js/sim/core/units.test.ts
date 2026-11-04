import { describe, expect, it } from 'vitest';
import b25jJson from '../../../sim/aircraft/b25j.json';
import { defaultInput, runningInput } from './aircraft';
import { Pid } from './ai/pid';
import { isa, turbulenceAt, windAt } from './atmosphere';
import { aircraftConfigSchema, parseAircraftConfig } from './config';
import { createEngine, defaultEngineControls, fullThrottleManifold, pressureAltitude, stepEngine } from './engine';
import {
    attitudeFromEuler,
    clamp,
    eulerFromAttitude,
    integrateQuat,
    interpolateTable,
    moveTowards,
    rotate,
    rotateInverse,
    vec,
    wrapPi,
} from './math';
import { hash32, Rng, valueNoise2 } from './rng';
import { Simulation } from './simulation';
import { CORSICA_ALESAN, FlatTerrain, ProceduralTerrain } from './terrain';
import { airborneSim, b25j, loadoutForMass } from './testing';

const close = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('math', () => {
    it('round-trips euler angles through quaternions', () => {
        for (const [h, p, r] of [
            [0, 0, 0],
            [1.2, 0.3, -0.4],
            [4.5, -0.2, 0.9],
        ] as const) {
            const e = eulerFromAttitude(attitudeFromEuler(h, p, r));

            close(e.heading, h, 1e-9);
            close(e.pitch, p, 1e-9);
            close(e.roll, r, 1e-9);
        }
    });

    it('maps the body nose to the heading direction in ENU', () => {
        const east = rotate(attitudeFromEuler(Math.PI / 2, 0, 0), vec(1, 0, 0));
        const down = rotate(attitudeFromEuler(0.7, 0, 0), vec(0, 0, 1));

        close(east.x, 1);
        close(down.z, -1);
    });

    it('rotateInverse undoes rotate and integration keeps unit quaternions', () => {
        const q = attitudeFromEuler(0.4, 0.1, 0.2);
        const v = rotateInverse(q, rotate(q, vec(1, 2, 3)));
        let spun = q;

        for (let i = 0; i < 600; i++) {
            spun = integrateQuat(spun, vec(0.3, -0.2, 0.5), 1 / 60);
        }

        close(v.y, 2);
        close(Math.hypot(spun.w, spun.x, spun.y, spun.z), 1, 1e-12);
    });

    it('has helpers for tables, wrapping and rate limits', () => {
        expect(interpolateTable([[0, 0], [10, 100]], 5)).toBe(50);
        expect(interpolateTable([[0, 0], [10, 100]], -1)).toBe(0);
        expect(interpolateTable([[0, 0], [10, 100]], 20)).toBe(100);
        expect(interpolateTable([], 1)).toBe(0);
        close(wrapPi(3 * Math.PI), Math.PI);
        close(wrapPi(-3 * Math.PI + 0.1), -Math.PI + 0.1);
        expect(moveTowards(0, 1, 0.25)).toBe(0.25);
        expect(clamp(5, 0, 1)).toBe(1);
    });
});

describe('rng', () => {
    it('is reproducible and restorable', () => {
        const a = new Rng(123);
        const b = new Rng(123);
        const seq = Array.from({ length: 5 }, () => a.next());

        expect(Array.from({ length: 5 }, () => b.next())).toEqual(seq);

        const state = a.getState();
        const next = a.next();

        a.setState(state);
        expect(a.next()).toBe(next);
    });

    it('produces values in range with sane statistics', () => {
        const rng = Rng.derive(7, 100, 3);
        let sum = 0;

        for (let i = 0; i < 5000; i++) {
            const v = rng.next();

            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThan(1);
            sum += rng.gaussian();
        }

        expect(Math.abs(sum / 5000)).toBeLessThan(0.1);
        expect(rng.range(5, 6)).toBeGreaterThanOrEqual(5);
        expect(typeof rng.chance(0.5)).toBe('boolean');
        expect(hash32(1, 2)).not.toBe(hash32(2, 1));
        expect(Math.abs(valueNoise2(1, 3.3, 4.4))).toBeLessThanOrEqual(1);
    });
});

describe('atmosphere', () => {
    it('matches the ISA table', () => {
        close(isa(0).density, 1.225, 1e-3);
        close(isa(5000).density, 0.7364, 2e-3);
        close(isa(11000).temperatureK, 216.65, 1e-6);
        close(isa(15000).pressurePa, 12045, 30);
        close(pressureAltitude(isa(4000).pressurePa), 4000, 5);
    });

    it('interpolates wind layers by altitude and blows from the given direction', () => {
        const weather = {
            wind: [
                { altitude_m: 0, from_deg: 270, speed_ms: 10 },
                { altitude_m: 2000, from_deg: 360, speed_ms: 20 },
            ],
            turbulence_ms: 0,
        };
        const low = windAt(weather, 0);
        const mid = windAt(weather, 1000);

        close(low.x, 10, 1e-9); // западный ветер дует на восток
        expect(Math.hypot(mid.x, mid.y)).toBeCloseTo(15, 5);
        expect(windAt(weather, 5000).y).toBeCloseTo(-20, 5);
        expect(windAt({ wind: [], turbulence_ms: 0 }, 100)).toEqual(vec());
        expect(turbulenceAt(weather, 1, vec(), 0)).toEqual(vec());
        expect(Math.abs(turbulenceAt({ ...weather, turbulence_ms: 3 }, 1, vec(50, 70, 900), 2).x)).toBeLessThanOrEqual(3);
    });
});

describe('aircraft config', () => {
    it('validates b25j.json and keeps TODO(history) markers for unknown data', () => {
        const config = parseAircraftConfig(b25jJson);

        expect(config.geometry.wingspan_m.value).toBe(20.6);
        expect(config.propellers.diameter_m.value).toBeNull();
        expect(config.propellers.diameter_m.todo).toContain('TODO(history)');
    });

    it('rejects a config without sources', () => {
        const broken = structuredClone(b25jJson) as Record<string, unknown> & { geometry: { wingspan_m: Record<string, unknown> } };

        delete broken.geometry.wingspan_m.source;
        expect(aircraftConfigSchema.safeParse(broken).success).toBe(false);
    });
});

describe('engine', () => {
    const env = { atmosphere: isa(0), trueAirspeed: 0, dynamicPressure: 0, batteryOn: true, fuelPumpOn: true, fuelAvailable: true };

    it('starts through the sequence battery → pump → primer → starter → magnetos → mixture', () => {
        let engine = createEngine(b25j, false);
        const controls = { ...defaultEngineControls(), primer: true };

        for (let i = 0; i < 60; i++) {
            engine = stepEngine(b25j, engine, controls, env, 1 / 60);
        }

        expect(engine.primed).toBeGreaterThanOrEqual(1);

        const crank = { ...controls, primer: false, starter: true, magnetos: true };

        for (let i = 0; i < 60 * 3; i++) {
            engine = stepEngine(b25j, engine, crank, env, 1 / 60);
        }

        expect(engine.mode).toBe('running');

        for (let i = 0; i < 120; i++) {
            engine = stepEngine(b25j, engine, { ...crank, starter: false, throttle: 0.1 }, env, 1 / 60);
        }

        expect(engine.rpm).toBeGreaterThan(500);
        expect(engine.powerW).toBeGreaterThan(0);

        engine = stepEngine(b25j, engine, { ...crank, starter: false, mixture: 0 }, env, 1 / 60);
        expect(engine.mode).toBe('off');
    });

    it('does not start without battery or without priming', () => {
        let noBattery = createEngine(b25j, false);
        let unprimed = createEngine(b25j, false);
        const crank = { ...defaultEngineControls(), starter: true, magnetos: true };

        for (let i = 0; i < 300; i++) {
            noBattery = stepEngine(b25j, noBattery, crank, { ...env, batteryOn: false }, 1 / 60);
            unprimed = stepEngine(b25j, unprimed, crank, env, 1 / 60);
        }

        expect(noBattery.mode).toBe('off');
        expect(unprimed.mode).toBe('cranking');
    });

    it('loses manifold pressure with altitude and accumulates wear when overboosted', () => {
        expect(fullThrottleManifold(b25j, 0)).toBeGreaterThan(fullThrottleManifold(b25j, 7000));

        let engine = { ...createEngine(b25j, true), manifoldInHg: 46 };
        const controls = { ...defaultEngineControls(), magnetos: true, throttle: 1 };

        for (let i = 0; i < 600; i++) {
            engine = stepEngine(b25j, { ...engine, manifoldInHg: 46 }, controls, env, 1 / 60);
        }

        expect(engine.wear).toBeGreaterThan(0);
        expect(engine.secondsInRed).toBeGreaterThan(5);
    });
});

describe('pid', () => {
    it('saturates and resets', () => {
        const pid = new Pid(10, 1, 0, 1);

        expect(pid.update(1, 0.1)).toBe(1);
        pid.reset();
        expect(pid.update(0, 0.1)).toBe(0);
    });
});

describe('ground handling', () => {
    const parked = (enginesRunning = false, z = 2.0) =>
        new Simulation({
            config: b25j,
            terrain: new FlatTerrain(0),
            seed: 1,
            initial: { position: vec(0, 0, z), heading: 0, speed: 0, gearDown: true, enginesRunning, loadout: loadoutForMass(b25j, 14500) },
        });

    it('sits still on its gear with brakes on', () => {
        const sim = parked();
        const input = defaultInput();

        input.brakeLeft = 1;
        input.brakeRight = 1;
        sim.run(60 * 10, input);

        expect(sim.aircraft.contact).toBe('gear');
        expect(Math.hypot(sim.aircraft.velocity.x, sim.aircraft.velocity.y, sim.aircraft.velocity.z)).toBeLessThan(0.05);
        expect(Math.abs(sim.derived().pitch)).toBeLessThan(0.05);
    });

    it('accelerates on the takeoff roll and steers with the nose wheel', () => {
        const sim = parked(true);
        const input = runningInput(1);

        input.yaw = 0.5;
        sim.run(60 * 6, input);

        expect(sim.derived().trueAirspeed).toBeGreaterThan(5);
        expect(sim.derived().heading).toBeGreaterThan(0.05);
    });

    it('lands on the belly with the gear up and crashes when hitting too hard', () => {
        const belly = airborneSim({ altitude: 6, speed: 55, gearDown: false });
        const input = runningInput(0);

        belly.run(60 * 8, input);
        expect(['belly', 'crashed']).toContain(belly.aircraft.contact);

        const crash = airborneSim({ altitude: 60, speed: 60 });

        crash.patchAircraft({ velocity: vec(0, 60, -25) });
        crash.run(60 * 4, input);
        expect(crash.aircraft.contact).toBe('crashed');
        expect(crash.aircraft.touchdownVs).toBeGreaterThan(6);

        const frozen = crash.stateHash();

        crash.run(10, input);
        expect(crash.aircraft.position).toEqual(crash.aircraft.position);
        expect(frozen).not.toBe('');
    });

    it('ditches on water east of the coast', () => {
        const terrain = new ProceduralTerrain(CORSICA_ALESAN);
        const sim = airborneSim({ altitude: 4, speed: 50, gearDown: false, terrain });

        sim.patchAircraft({ position: vec(9000, 0, 4) });
        sim.run(60 * 6, runningInput(0));

        expect(terrain.isWater(9000, 0)).toBe(true);
        expect(['water', 'crashed']).toContain(sim.aircraft.contact);
    });
});

describe('terrain', () => {
    it('keeps the airfield flat, the sea at zero and mountains to the west', () => {
        const terrain = new ProceduralTerrain(CORSICA_ALESAN);
        const runway = CORSICA_ALESAN.runways[0]!;

        for (let y = -runway.length_m / 2; y <= runway.length_m / 2; y += 300) {
            close(terrain.heightAt(runway.x, y), runway.elevation_m, 0.01);
        }

        expect(terrain.heightAt(12000, 0)).toBe(0);
        expect(terrain.heightAt(-25000, 0)).toBeGreaterThan(600);
        expect(terrain.runways).toHaveLength(1);
    });
});
