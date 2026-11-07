import * as THREE from 'three';
import type { Placer, VehicleKind } from './airfieldProps';
import { createVehicleModel } from './airfieldProps';
import type { TaxiPath } from './paths';
import { offsetPath, pointAt, roundedPath } from './paths';

/**
 * Сервисные дороги и машины на фоне главного меню. Дороги — справа от полосы (там, где кадр не закрыт меню):
 * продольная вдоль поля, петля к ангарам и баракам, отворот к лагерю и выезды в поле. Оба конца сети — за краем
 * кадра: позади камеры и далеко справа, поэтому машины въезжают в кадр и уезжают из него, а не появляются на виду.
 *
 * Координаты — в осях полосы, along — метры от торца (как в airfieldProps), across — вправо.
 */
export type Waypoint = { along: number; across: number };

export const ROAD_WIDTH = 6;
/** Радиус скругления углов дорог, м. */
const ROAD_RADIUS = 10;
/** Правая полоса: смещение от оси дороги, м. */
const LANE = 1.6;

const BEHIND = { along: -150, across: 55 };
// Выезды в поле — далеко вбок (за край кадра даже на широком экране); справа от полосы — ровная равнина.
const FAR_EXIT = { along: 1400, across: 1700 };
const CAMP_EXIT = { along: 870, across: 1200 };

export const ROADS: Waypoint[][] = [
    // Продольная дорога вдоль поля и выезд в поле за дальним концом.
    [BEHIND, { along: 1400, across: 55 }, FAR_EXIT],
    // Петля к ангарам, баракам, мачте и водонапорной башне.
    [
        { along: 490, across: 55 },
        { along: 490, across: 150 },
        { along: 630, across: 150 },
        { along: 630, across: 55 },
    ],
    // Отворот к палаточному лагерю и выезд в поле.
    [{ along: 870, across: 55 }, CAMP_EXIT],
];

const ROUTES_ONE_WAY: Waypoint[][] = [
    [BEHIND, { along: 1400, across: 55 }, FAR_EXIT],
    [BEHIND, { along: 490, across: 55 }, { along: 490, across: 150 }, { along: 630, across: 150 }, { along: 630, across: 55 }, BEHIND],
    [BEHIND, { along: 870, across: 55 }, CAMP_EXIT],
    [CAMP_EXIT, { along: 870, across: 55 }, { along: 1400, across: 55 }, FAR_EXIT],
];

/** Маршруты машин: в обе стороны, по правой полосе. */
export const VEHICLE_ROUTES: TaxiPath[] = [...ROUTES_ONE_WAY, ...ROUTES_ONE_WAY.map((r) => [...r].reverse())].map((r) =>
    offsetPath(roundedPath(r, ROAD_RADIUS), LANE),
);

/** Камера фона в тех же осях (у торца, слева от полосы) и половина горизонтального угла с запасом на широкий экран. */
export const MENU_CAMERA = { along: 10, across: -40 };
const HALF_FOV = (45 * Math.PI) / 180;

export function inCameraView(p: { along: number; across: number }, camera = MENU_CAMERA): boolean {
    const forward = p.along - camera.along;

    return forward > 0 && Math.abs(Math.atan2(p.across - camera.across, forward)) < HALF_FOV;
}

/**
 * Видимая часть маршрута: машина появляется за 30 м до входа в кадр и убирается через 30 м после выхода — не тратит
 * минуты на невидимые выезды в поле. Оба конца окна — за краем кадра.
 */
export function routeWindow(path: TaxiPath, camera = MENU_CAMERA): { startS: number; endS: number } {
    let first = -1;
    let last = -1;

    for (let d = 0; d <= path.length; d += 2) {
        if (inCameraView(pointAt(path, d), camera)) {
            first = first < 0 ? d : first;
            last = d;
        }
    }

    if (first < 0) {
        return { startS: 0, endS: path.length };
    }

    return { startS: Math.max(0, first - 30), endS: Math.min(path.length, last + 30) };
}

/** Грунтовые дороги: лента по рельефу (каждая вершина — на высоте земли). */
export function buildRoads(scene: THREE.Scene, place: Placer): { dispose(): void } {
    const material = new THREE.MeshLambertMaterial({ color: 0x8b7b58, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 });
    const disposables: { dispose(): void }[] = [material];
    const dummy = new THREE.Object3D();

    for (const road of ROADS) {
        const path = roundedPath(road, ROAD_RADIUS);
        const positions: number[] = [];
        const indices: number[] = [];

        path.points.forEach((pt, i) => {
            for (const sign of [-1, 1]) {
                place(dummy, pt.along - Math.sin(pt.yaw) * sign * (ROAD_WIDTH / 2), pt.across + Math.cos(pt.yaw) * sign * (ROAD_WIDTH / 2));
                positions.push(dummy.position.x, dummy.position.y + 0.05, dummy.position.z);
            }

            if (i > 0) {
                const k = i * 2;

                indices.push(k - 2, k - 1, k, k - 1, k + 1, k);
            }
        });

        const geometry = new THREE.BufferGeometry();

        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();
        disposables.push(geometry);
        scene.add(new THREE.Mesh(geometry, material));
    }

    return { dispose: () => disposables.forEach((d) => d.dispose()) };
}

type Vehicle = { id: number; kind: VehicleKind; model: { root: THREE.Object3D; dispose(): void }; path: TaxiPath; endS: number; s: number; speed: number; maxSpeed: number; along: number; across: number; yaw: number; stuckS: number };

export type TrafficOptions = {
    /** Пауза между выездами, с. */
    gapS?: [number, number];
    /** Сколько машин одновременно. */
    max?: number;
};

/**
 * Случайное движение: грузовики (до 7 м/с) и джипы (до 10 м/с) по маршрутам VEHICLE_ROUTES. В поворотах — 4 м/с
 * (торможение заранее), машина впереди по той же полосе ближе 18 м — притормозить, ближе 9 м — встать; на съезде
 * и перекрёстке младшая уступает старшей. Простояла 10 с — ехать (страховка).
 */
export function createTraffic(scene: THREE.Scene, place: Placer, random: () => number, options: TrafficOptions = {}): { update(dt: number): void; dispose(): void; readonly count: number } {
    const [minGap, maxGap] = options.gapS ?? [6, 18];
    const max = options.max ?? 4;
    const vehicles: Vehicle[] = [];
    const windows = VEHICLE_ROUTES.map((r) => routeWindow(r));
    let nextS = 2 + random() * 3;
    let nextId = 0;

    const spawn = (): void => {
        const index = Math.min(VEHICLE_ROUTES.length - 1, Math.floor(random() * VEHICLE_ROUTES.length));
        const path = VEHICLE_ROUTES[index]!;
        const span = windows[index]!;
        const start = pointAt(path, span.startS);

        // Въезд занят — подождать.
        if (vehicles.some((v) => Math.hypot(v.along - start.along, v.across - start.across) < 30)) {
            return;
        }

        const kind: VehicleKind = random() < 0.55 ? 'truck' : 'jeep';
        const model = createVehicleModel(kind);

        scene.add(model.root);
        vehicles.push({ id: nextId++, kind, model, path, endS: span.endS, s: span.startS, speed: 0, maxSpeed: kind === 'truck' ? 6 + random() : 8.5 + random() * 1.5, along: start.along, across: start.across, yaw: start.yaw, stuckS: 0 });
    };

    const update = (dt: number): void => {
        nextS -= dt;

        if (nextS <= 0) {
            if (vehicles.length < max) {
                spawn();
            }

            nextS = minGap + random() * (maxGap - minGap);
        }

        for (const v of vehicles) {
            const here = pointAt(v.path, v.s);
            const toTurn = Math.max(0, here.nextTurnS - v.s);
            let target = here.turn ? 4 : Math.min(v.maxSpeed, Math.sqrt(16 + 2 * 2.5 * toTurn));

            // Машина впереди по той же полосе.
            const dirA = Math.cos(v.yaw);
            const dirC = Math.sin(v.yaw);

            for (const u of v.stuckS > 10 ? [] : vehicles) {
                if (u === v) {
                    continue;
                }

                const da = u.along - v.along;
                const dc = u.across - v.across;
                const ahead = da * dirA + dc * dirC;
                const lateral = Math.abs(da * dirC - dc * dirA);
                const sameWay = Math.cos(u.yaw - v.yaw) > 0.85;

                // Впереди по той же полосе — держать дистанцию.
                if (sameWay && ahead > 0 && ahead < 18 && lateral < 2.5) {
                    target = Math.min(target, ahead < 9 ? 0 : u.speed);
                }

                // Конфликт на съезде или перекрёстке: младшая машина уступает старшей (у старших приоритет —
                // поэтому взаимной блокировки не бывает).
                if (!sameWay && u.id < v.id && ahead > 0 && Math.hypot(da, dc) < 12) {
                    target = 0;
                }
            }

            v.speed = v.speed < target ? Math.min(target, v.speed + 1.5 * dt) : Math.max(target, v.speed - 3.5 * dt);
            v.stuckS = v.speed < 0.3 ? v.stuckS + dt : 0;
            v.s = Math.min(v.endS, v.s + v.speed * dt);

            const p = pointAt(v.path, v.s);

            v.along = p.along;
            v.across = p.across;
            v.yaw = p.yaw;
            place(v.model.root, p.along, p.across, p.yaw);
        }

        // Выехавшие из кадра в конце маршрута — убрать.
        for (let i = vehicles.length - 1; i >= 0; i--) {
            const v = vehicles[i]!;

            if (v.s >= v.endS - 0.05) {
                scene.remove(v.model.root);
                v.model.dispose();
                vehicles.splice(i, 1);
            }
        }
    };

    return {
        update,
        dispose: () => vehicles.forEach((v) => v.model.dispose()),
        get count() {
            return vehicles.length;
        },
    };
}
