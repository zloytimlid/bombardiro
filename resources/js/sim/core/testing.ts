import b25jJson from '../../../sim/aircraft/b25j.json';
import type { AircraftInput, Loadout } from './aircraft';
import type { AutopilotTargets } from './ai/autopilot';
import { Autopilot } from './ai/autopilot';
import type { AircraftConfig } from './config';
import { parseAircraftConfig } from './config';
import { vec } from './math';
import { DT, Simulation } from './simulation';
import type { Terrain } from './terrain';
import { FlatTerrain } from './terrain';

/** Вспомогательные функции для тестов и калибровки ядра (без рендера). */
export const b25j: AircraftConfig = parseAircraftConfig(b25jJson);

/** Загрузка, дающая заданную полную массу: экипаж 6, без бомб, остальное — топливо. */
export function loadoutForMass(config: AircraftConfig, massKg: number): Loadout {
    const crew = 6;
    const ammoKg = 300;
    const fuelKg = massKg - config.mass.empty_kg.value - crew * config.mass.crew_member_kg.value - ammoKg;

    return { crew, ammoKg, bombsKg: 0, fuelKg: Math.max(fuelKg, 0) };
}

export function airborneSim(options: {
    altitude: number;
    speed: number;
    heading?: number;
    massKg?: number;
    seed?: number;
    terrain?: Terrain;
    gearDown?: boolean;
    flaps?: number;
}): Simulation {
    const config = b25j;

    return new Simulation({
        config,
        terrain: options.terrain ?? new FlatTerrain(0),
        seed: options.seed ?? 1,
        initial: {
            position: vec(0, 0, options.altitude),
            heading: options.heading ?? 0,
            pitch: 0.03,
            speed: options.speed,
            gearDown: options.gearDown ?? false,
            flaps: options.flaps ?? 0,
            enginesRunning: true,
            loadout: loadoutForMass(config, options.massKg ?? config.performance_targets.reference_mass_kg.value),
        },
    });
}

/** Прогон с автопилотом; возвращает средние за последние `averageS` секунд. */
export function flyWithAutopilot(
    sim: Simulation,
    targets: AutopilotTargets | ((sim: Simulation) => AutopilotTargets),
    seconds: number,
    averageS = 20,
    tweak?: (input: AircraftInput) => void,
): { ias: number; tas: number; vs: number; altitude: number } {
    const ap = new Autopilot();
    const ticks = Math.round(seconds / DT);
    const avgTicks = Math.round(averageS / DT);
    let ias = 0;
    let tas = 0;
    let vs = 0;

    for (let i = 0; i < ticks; i++) {
        const d = sim.derived();
        const t = typeof targets === 'function' ? targets(sim) : targets;
        const input = ap.update(sim.aircraft, d, t, DT);

        tweak?.(input);
        sim.step(input);

        if (i >= ticks - avgTicks) {
            const after = sim.derived();

            ias += after.indicatedAirspeed;
            tas += after.trueAirspeed;
            vs += after.verticalSpeed;
        }
    }

    return { ias: ias / avgTicks, tas: tas / avgTicks, vs: vs / avgTicks, altitude: sim.derived().altitude };
}

export const kmh = (ms: number): number => ms * 3.6;
