import { describe, expect, it } from 'vitest';
import { AIRFIELD_LAYOUT } from './airfieldProps';
import type { TaxiPath } from './menuScene';
import { CORSICA_ALESAN, ProceduralTerrain } from '@/sim/core/terrain';
import { buildExitPath, buildTaxiPath, formationSlots, formationTrack, pointAt } from './menuScene';

describe('menu scene taxi path', () => {
    // Как в сцене: торец −1000 м от центра полосы, исполнительный старт в 260 м от торца, стоянка слева.
    const threshold = -1000;
    const lineup = threshold + 260;
    const path = buildTaxiPath(lineup, 30, threshold + 110, -150);
    const first = path.points[0]!;
    const last = path.points[path.points.length - 1]!;

    it('starts outside the camera view and ends on the centreline at the lineup point', () => {
        // Камера у торца: (threshold + 10, −40, 7 м), смотрит вдоль полосы; половина горизонтального угла обзора < 35°.
        const forward = first.along - (threshold + 10);
        const left = -40 - first.across;

        expect(Math.atan2(left, forward)).toBeGreaterThan((35 * Math.PI) / 180);
        expect(last.along).toBeCloseTo(lineup, 6);
        expect(last.across).toBeCloseTo(0, 6);
    });

    it('is continuous and leaves the runway heading at the end', () => {
        for (let i = 1; i < path.points.length; i++) {
            const a = path.points[i - 1]!;
            const b = path.points[i]!;

            expect(Math.hypot(b.along - a.along, b.across - a.across)).toBeLessThan(6);
        }

        const prev = path.points[path.points.length - 2]!;

        // Курс по касательной меняется плавно (без ступенек) и совпадает с направлением движения.
        for (let i = 1; i < path.points.length; i++) {
            const a = path.points[i - 1]!;
            const b = path.points[i]!;
            const step = Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw));

            expect(Math.abs(step)).toBeLessThan((3 * Math.PI) / 180);

            const moving = Math.atan2(b.across - a.across, b.along - a.along);

            expect(Math.abs(Math.atan2(Math.sin(moving - b.yaw), Math.cos(moving - b.yaw)))).toBeLessThan(0.05);
        }

        expect(last.yaw).toBeCloseTo(0, 6);

        // Перед первым разворотом известно, где он начинается (торможение заранее).
        expect(first.nextTurnS).toBeGreaterThan(0);
        expect(first.nextTurnS).toBeLessThan(path.length);

        // Последний участок — вдоль полосы (курс 0), длина пути — разумная для фона меню.
        expect(Math.atan2(last.across - prev.across, last.along - prev.along)).toBeCloseTo(0, 1);
        expect(path.length).toBeGreaterThan(200);
        expect(path.length).toBeLessThan(400);
    });

    const exit = buildExitPath(threshold + 1100, 35, -150, threshold + 30);
    const smooth = (p: TaxiPath): void => {
        for (let i = 1; i < p.points.length; i++) {
            const a = p.points[i - 1]!;
            const b = p.points[i]!;

            expect(Math.hypot(b.along - a.along, b.across - a.across)).toBeLessThan(1.6);
            expect(Math.abs(Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw)))).toBeLessThan((3 * Math.PI) / 180);
        }
    };

    it('takes a landing aircraft off the centreline onto the parallel taxiway and out of view', () => {
        const start = exit.points[0]!;
        const end = exit.points[exit.points.length - 1]!;

        expect(start.along).toBe(threshold + 1100);
        expect(start.across).toBe(0);
        expect(start.yaw).toBe(0);
        expect(end.across).toBeCloseTo(-150, 6);
        expect(Math.abs(end.yaw)).toBeCloseTo(Math.PI, 6);
        // Конец — за левым краем кадра, как и стоянка взлетающих.
        expect(Math.atan2(-40 - end.across, end.along - (threshold + 10))).toBeGreaterThan((35 * Math.PI) / 180);
        smooth(exit);
        smooth(path);
    });

    it('keeps both taxi routes clear of the parked aircraft, tents and tower', () => {
        const obstacles = [
            { along: threshold + 290, across: -82, r: 12 },
            { along: threshold + 340, across: -95, r: 12 },
            { along: threshold + 395, across: -86, r: 12 },
            ...Array.from({ length: 6 }, (_, i) => ({ along: threshold + 440 + i * 14, across: -120 - (i % 2) * 8, r: 4 })),
            { along: threshold + 470, across: -110, r: 4 },
        ];

        for (const route of [path, exit]) {
            for (let d = 0; d <= route.length; d += 1) {
                const pt = pointAt(route, d);

                for (const o of obstacles) {
                    // Полуширина рулёжки 7,5 м плюс полуразмах самолёта на ней ~10 м.
                    expect(Math.hypot(pt.along - o.along, pt.across - o.across)).toBeGreaterThan(o.r + 10);
                }
            }
        }
    });

    it('builds formations with the lead in front and wingmen at a safe distance', () => {
        for (const [kind, count] of [['vic', 3], ['echelon', 4], ['box', 6]] as const) {
            const slots = formationSlots(kind);

            expect(slots).toHaveLength(count);
            expect(slots[0]).toEqual({ back: 0, right: 0, up: 0 });

            for (let i = 0; i < slots.length; i++) {
                expect(slots[i]!.back).toBeGreaterThanOrEqual(0);

                for (let j = i + 1; j < slots.length; j++) {
                    const a = slots[i]!;
                    const b = slots[j]!;

                    // Размах B-25J ~20,6 м: машины строя не ближе 20 м друг к другу.
                    expect(Math.hypot(a.back - b.back, a.right - b.right, a.up - b.up)).toBeGreaterThan(20);
                }
            }
        }
    });

    it('places airfield structures off the runway and clear of both taxi routes', () => {
        for (const p of AIRFIELD_LAYOUT) {
            // Полоса 45 м и полуразмах самолёта ~10 м по каждую сторону.
            expect(Math.abs(p.across) - p.radius, p.kind).toBeGreaterThan(22.5 + 10);

            for (const route of [path, exit]) {
                for (let d = 0; d <= route.length; d += 1) {
                    const pt = pointAt(route, d);

                    expect(Math.hypot(pt.along - (threshold + p.along), pt.across - p.across), `${p.kind} at ${p.along}`).toBeGreaterThan(p.radius + 7.5 + 10);
                }
            }
        }
    });

    it('routes a formation from any side past the camera at the requested offset', () => {
        const camera = { along: -890, across: -40 };

        for (const course of [0, 1, 2.5, Math.PI, 4, 5.5]) {
            const tr = formationTrack(course, 30, camera, 6500);
            // Ближайшая к камере точка линии пути — через 6,5 км от старта.
            const nearAlong = tr.startAlong + tr.dirAlong * 6500;
            const nearAcross = tr.startAcross + tr.dirAcross * 6500;

            expect(Math.hypot(nearAlong - camera.along, nearAcross - camera.across)).toBeCloseTo(30, 6);
            expect(Math.hypot(tr.startAlong - camera.along, tr.startAcross - camera.across)).toBeCloseTo(Math.hypot(6500, 30), 3);
            // «Вправо» — перпендикулярно ходу.
            expect(tr.dirAlong * tr.rightAlong + tr.dirAcross * tr.rightAcross).toBeCloseTo(0, 9);
        }
    });

    it('finds enough low-terrain courses around Alesani for formations to come from different sides', () => {
        const terrain = new ProceduralTerrain(CORSICA_ALESAN);
        const rw = CORSICA_ALESAN.runways[0]!;
        const camera = { along: -rw.length_m / 2 + 10, across: -40 };
        const toEnu = (along: number, across: number): { x: number; y: number } => ({
            x: rw.x + Math.sin(rw.heading) * along + Math.cos(rw.heading) * across,
            y: rw.y + Math.cos(rw.heading) * along - Math.sin(rw.heading) * across,
        });
        let clear = 0;
        const total = 36;

        for (let i = 0; i < total; i++) {
            const tr = formationTrack((i / total) * Math.PI * 2, 0, camera, 6500);
            let ok = true;

            for (let d = 0; d <= 9500 && ok; d += 200) {
                const p = toEnu(tr.startAlong + tr.dirAlong * d, tr.startAcross + tr.dirAcross * d);

                ok = terrain.heightAt(p.x, p.y) - rw.elevation_m <= 60;
            }

            clear += ok ? 1 : 0;
        }

        console.info(`formation courses clear of terrain: ${clear}/${total}`);
        expect(clear / total).toBeGreaterThan(0.25);
    });
});
