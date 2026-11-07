import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AIRFIELD_LAYOUT } from './airfieldProps';
import type { Placer } from './airfieldProps';
import { buildExitPath, buildTaxiPath } from './menuScene';
import { pointAt, roundedPath } from './paths';
import { createTraffic, ROAD_WIDTH, ROADS, routeWindow, VEHICLE_ROUTES } from './roads';

/** Детерминированный генератор для теста (сцена меню принимает random снаружи). */
function lcg(seed: number): () => number {
    let x = seed;

    return () => {
        x = (x * 1664525 + 1013904223) % 4294967296;

        return x / 4294967296;
    };
}

// Как в сцене: камера у торца (along 10 м от торца, 40 м слева), половина горизонтального угла обзора < 45° даже на широком экране.
const camera = { along: 10, across: -40 };
const roadPoints = ROADS.flatMap((r) => {
    const path = roundedPath(r, 10);
    const pts = [];

    for (let d = 0; d <= path.length; d += 1) {
        pts.push(pointAt(path, d));
    }

    return pts;
});

describe('menu scene service roads', () => {
    it('keep off the runway, the structures and the taxi routes', () => {
        for (const p of roadPoints) {
            expect(Math.abs(p.across) - ROAD_WIDTH / 2).toBeGreaterThan(22.5 + 5);

            for (const o of AIRFIELD_LAYOUT) {
                expect(Math.hypot(p.along - o.along, p.across - o.across), `${o.kind} at ${o.along}`).toBeGreaterThan(o.radius + ROAD_WIDTH / 2 + 1);
            }
        }

        // Пути руления — в тех же осях (от торца), как их строит сцена.
        const T = 0;
        const taxi = buildTaxiPath(T + 260, 30, T + 110, -150);
        const exit = buildExitPath(T + 1100, 35, -150, T + 30);

        for (const route of [taxi, exit]) {
            for (let d = 0; d <= route.length; d += 2) {
                const t = pointAt(route, d);

                for (const p of roadPoints) {
                    expect(Math.hypot(p.along - t.along, p.across - t.across)).toBeGreaterThan(7.5 + ROAD_WIDTH / 2 + 2);
                }
            }
        }
    });

    it('route vehicles in and out of view, never popping up on screen', () => {
        const outOfView = (p: { along: number; across: number }): boolean => {
            const forward = p.along - camera.along;
            const right = p.across - camera.across;

            return forward < 0 || Math.abs(Math.atan2(right, forward)) > (45 * Math.PI) / 180;
        };

        for (const route of VEHICLE_ROUTES) {
            expect(outOfView(route.points[0]!)).toBe(true);
            expect(outOfView(route.points[route.points.length - 1]!)).toBe(true);

            // Машина появляется и убирается за краем кадра, но видимый участок у маршрута есть.
            const w = routeWindow(route);

            expect(outOfView(pointAt(route, w.startS))).toBe(true);
            expect(outOfView(pointAt(route, w.endS))).toBe(true);
            expect(w.endS - w.startS).toBeGreaterThan(200);

            for (let i = 1; i < route.points.length; i++) {
                const a = route.points[i - 1]!;
                const b = route.points[i]!;

                expect(Math.hypot(b.along - a.along, b.across - a.across)).toBeLessThan(1.6);
                expect(Math.abs(Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw)))).toBeLessThan((7 * Math.PI) / 180);
            }
        }
    });

    it('runs random trucks and jeeps without collisions and clears them at the route ends', () => {
        const scene = new THREE.Scene();
        // Земля плоская: ставим в осях полосы как есть (x — along, z — across).
        const place: Placer = (obj, along, across, yaw = 0) => {
            obj.position.set(along, 0, across);
            obj.rotation.set(0, -yaw, 0);
        };
        const traffic = createTraffic(scene, place, lcg(7), { gapS: [2, 5], max: 4 });
        let peak = 0;
        let spawned = 0;
        let last = 0;

        for (let t = 0; t < 900; t += 0.1) {
            traffic.update(0.1);
            peak = Math.max(peak, traffic.count);
            spawned += Math.max(0, traffic.count - last);
            last = traffic.count;

            // Ни одна пара машин не стоит друг в друге (кузова ~5 м).
            const roots = scene.children;

            for (let i = 0; i < roots.length; i++) {
                for (let j = i + 1; j < roots.length; j++) {
                    expect(roots[i]!.position.distanceTo(roots[j]!.position)).toBeGreaterThan(3);
                }
            }
        }

        expect(spawned).toBeGreaterThan(10);
        expect(peak).toBeLessThanOrEqual(4);
        // Доехавшие до конца маршрута убираются со сцены (иначе машины копились бы).
        expect(spawned - traffic.count).toBeGreaterThan(8);
        expect(scene.children).toHaveLength(traffic.count);
        traffic.dispose();
    });
});
