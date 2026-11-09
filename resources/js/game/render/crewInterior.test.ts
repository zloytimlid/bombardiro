import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import b25j from '../../../sim/aircraft/b25j.json';
import { STATIONS } from '@/sim/core/config';
import { mountDirectionBody } from '@/sim/core/guns';
import { aimRig, createCrewInteriors, FUSELAGE_AXIS_Z, POD_WALLS, PODS_FOR_STATION, SHELL_HIDDEN_FROM } from './crewInterior';

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

    it('points a gun rig exactly where the sim fires (mountDirectionBody)', () => {
        const rig = new THREE.Object3D();
        const deg = Math.PI / 180;

        for (const [az, el] of [
            [0, 0],
            [40, 30],
            [-90, 5],
            [130, 25],
            [180, -20],
            [-60, -30],
        ] as const) {
            aimRig(rig, az * deg, el * deg);
            rig.updateMatrix();

            const barrel = new THREE.Vector3(1, 0, 0).applyQuaternion(rig.quaternion);
            const sim = mountDirectionBody(az * deg, el * deg);

            expect(barrel.x, `${az}/${el}`).toBeCloseTo(sim.x, 6);
            expect(barrel.y, `${az}/${el}`).toBeCloseTo(sim.y, 6);
            expect(barrel.z, `${az}/${el}`).toBeCloseTo(sim.z, 6);
        }
    });

    it('turns the turret, waist and tail guns with their mounts', () => {
        const interiors = createCrewInteriors();
        const turret = interiors.group.getObjectByName('gun_top_turret')!;
        const tail = interiors.group.getObjectByName('gun_tail')!;

        // Положение покоя — центр сектора: хвостовые смотрят назад, правый бортовой — вправо.
        expect(new THREE.Vector3(1, 0, 0).applyQuaternion(tail.quaternion).x).toBeCloseTo(-1, 6);
        expect(new THREE.Vector3(1, 0, 0).applyQuaternion(interiors.group.getObjectByName('gun_waist_right')!.quaternion).y).toBeCloseTo(1, 6);

        interiors.aim([
            { id: 'top_turret', az: Math.PI / 2, el: 0 },
            { id: 'unknown_mount', az: 1, el: 1 },
        ]);
        expect(new THREE.Vector3(1, 0, 0).applyQuaternion(turret.quaternion).y).toBeCloseTo(1, 6);
        interiors.dispose();
    });
});
