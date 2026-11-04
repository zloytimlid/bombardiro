import { describe, expect, it } from 'vitest';
import { airborneSim, b25j, flyWithAutopilot, kmh } from './testing';

/**
 * Калибровочные тесты «лётная огибающая» (раздел 7.1, этап 1): ядро без рендера
 * против performance_targets из b25j.json, допуск из того же файла.
 */
const targets = b25j.performance_targets;

const within = (actual: number, expected: number, tolerance: number): void => {
    expect(Math.abs(actual - expected) / expected).toBeLessThanOrEqual(tolerance);
};

describe('flight envelope (b25j.json performance_targets)', () => {
    it('reaches max speed at the rated altitude on full power', () => {
        const target = targets.max_speed_kmh;
        const sim = airborneSim({ altitude: target.at_altitude_m, speed: 115 });
        const result = flyWithAutopilot(sim, { altitude: target.at_altitude_m, heading: 0, throttle: 1, prop: 1 }, 240);

        console.info(`max speed: ${kmh(result.tas).toFixed(1)} km/h TAS at ${result.altitude.toFixed(0)} m`);
        expect(Math.abs(result.vs)).toBeLessThan(0.3);
        within(kmh(result.tas), target.value, target.tolerance);
    });

    it('cruises at the cruise speed on the cruise setting', () => {
        const setting = targets.cruise_setting.value;
        const rpmFraction =
            (setting.rpm - b25j.engines.power_curve.value.rpm_min_governed) /
            (b25j.engines.power_curve.value.rpm_rated - b25j.engines.power_curve.value.rpm_min_governed);
        const sim = airborneSim({ altitude: setting.altitude_m, speed: 100 });
        const result = flyWithAutopilot(
            sim,
            { altitude: setting.altitude_m, heading: 0, throttle: setting.throttle, prop: rpmFraction },
            240,
        );

        console.info(`cruise: ${kmh(result.tas).toFixed(1)} km/h TAS`);
        within(kmh(result.tas), targets.cruise_speed_kmh.value, targets.cruise_speed_kmh.tolerance);
    });

    it('has the service ceiling where the best climb rate drops to 0.5 m/s', () => {
        const ceiling = targets.service_ceiling_m;
        const climbAt = (altitude: number): number => {
            const sim = airborneSim({ altitude, speed: 100 });

            return flyWithAutopilot(sim, { airspeedByPitch: 66, heading: 0, throttle: 1, prop: 1 }, 180, 90).vs;
        };
        const below = climbAt(ceiling.value * (1 - ceiling.tolerance));
        const above = climbAt(ceiling.value * (1 + ceiling.tolerance));

        console.info(`climb below ceiling ${below.toFixed(2)} m/s, above ${above.toFixed(2)} m/s`);
        expect(below).toBeGreaterThan(0.5);
        expect(above).toBeLessThan(0.5);
    });

    it('cannot hold level flight below the clean stall speed', () => {
        // Цель stall_speed_kmh — TODO(history); проверяем согласованность с cl_max.
        const a = b25j.aero;
        const mass = targets.reference_mass_kg.value;
        const vs = Math.sqrt((2 * mass * 9.80665) / (1.225 * b25j.geometry.wing_area_m2.value * a.cl_max));
        const sim = airborneSim({ altitude: 1500, speed: vs * 0.85 });

        flyWithAutopilot(sim, { altitude: 1500, heading: 0, throttle: 0.2 }, 20, 5);

        expect(sim.derived().altitude).toBeLessThan(1500 - 30);
        expect(kmh(vs)).toBeGreaterThan(150);
        expect(kmh(vs)).toBeLessThan(230);
    });
});
