import { describe, expect, it } from 'vitest';
import b25j from '../../../sim/aircraft/b25j.json';
import { STATIONS } from '@/sim/core/config';
import { createCrewInteriors, FUSELAGE_AXIS_Z, POD_WALLS, PODS_FOR_STATION, SHELL_HIDDEN_FROM } from './crewInterior';

const eyes = b25j.gameplay_station_eyes.value as unknown as Record<string, [number, number, number]>;

/** Угол θ точки сечения (0 — верх, +90° — правый борт) и расстояние до оси фюзеляжа. */
const polar = (y: number, z: number): { th: number; r: number } => ({
    th: (Math.atan2(y, -(z - FUSELAGE_AXIS_Z)) * 180) / Math.PI,
    r: Math.hypot(y, z - FUSELAGE_AXIS_Z),
});

describe('crew interiors for first-person views', () => {
    it('gives every station a compartment', () => {
        for (const s of STATIONS) {
            expect(PODS_FOR_STATION[s].length, s).toBeGreaterThan(0);
        }
    });

    it('keeps the eyes of stations with the hull hidden inside their compartment walls', () => {
        for (const s of SHELL_HIDDEN_FROM) {
            const [x, y, z] = eyes[s]!;
            const walls = POD_WALLS[PODS_FOR_STATION[s][0]!];

            expect(x, s).toBeGreaterThanOrEqual(walls.x0 - 0.05);
            expect(x, s).toBeLessThanOrEqual(walls.x1 + 0.05);
            // Глаз не ближе 15 см к стенке — иначе камера «упирается» в неё.
            expect(polar(y, z).r, s).toBeLessThan(walls.r - 0.15);
        }
    });

    it('cuts the waist and navigator windows where those crew look out', () => {
        const waist = eyes.waist_gunner!;
        const right = POD_WALLS.waist.windows!.find((w) => w.th0 > 0)!;
        // Взгляд вправо по горизонтали от глаза пересекает стенку на высоте глаза: θ = acos(−dz / r).
        const dz = waist[2] - FUSELAGE_AXIS_Z;
        const thRight = (Math.acos(-dz / POD_WALLS.waist.r) * 180) / Math.PI;

        expect(waist[0]).toBeGreaterThan(right.x0);
        expect(waist[0]).toBeLessThan(right.x1);
        expect(thRight).toBeGreaterThan(right.th0);
        expect(thRight).toBeLessThan(right.th1);
        expect(POD_WALLS.waist.windows!.some((w) => w.th1 < 0)).toBe(true);
        expect(POD_WALLS.navigator.windows!.length).toBeGreaterThan(0);
    });

    it('shows only the compartments of the current station and hides them in the external view', () => {
        const interiors = createCrewInteriors();

        interiors.show('waist_gunner');
        expect(interiors.pods.waist.visible).toBe(true);
        expect(interiors.pods.cockpit.visible).toBe(false);

        interiors.show('navigator');
        expect(interiors.pods.navigator.visible && interiors.pods.cockpit.visible).toBe(true);
        expect(interiors.pods.waist.visible).toBe(false);

        interiors.show(null);
        expect(Object.values(interiors.pods).some((p) => p.visible)).toBe(false);
        interiors.dispose();
    });
});
