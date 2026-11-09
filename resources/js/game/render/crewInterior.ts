import * as THREE from 'three';
import type { Station } from '@/sim/core';

/**
 * Внутренние отсеки экипажа для вида от первого лица (раздел 12): кабина пилотов, штурманский отсек, нос бомбардира,
 * верхняя турель, отсек радиста и бортовых стрелков, хвост. Процедурная игровая геометрия (source: gameplay), не
 * реконструкция по чертежам. Оси — FRD модели (x — к носу, y — вправо, z — вниз), группа крепится к model.root.
 *
 * Стенки отсека — сегменты трубы по оси фюзеляжа с вырезами под окна: снаружи видно небо и землю. Обшивку снаружи
 * игра скрывает только у мест, чьи глаза внутри фюзеляжа (SHELL_HIDDEN_FROM); бомбардир, верхний и хвостовой
 * стрелки сидят под остеклением — им видна наружная модель.
 */
export type PodName = 'cockpit' | 'navigator' | 'nose' | 'turret' | 'waist' | 'tail';

/** Какие отсеки видны с места (соседний — если в него смотрят: штурман видит спины пилотов). */
export const PODS_FOR_STATION: Record<Station, PodName[]> = {
    pilot: ['cockpit', 'navigator'],
    copilot: ['cockpit', 'navigator'],
    navigator: ['navigator', 'cockpit'],
    bombardier: ['nose'],
    top_gunner: ['turret'],
    radio: ['waist'],
    waist_gunner: ['waist'],
    tail_gunner: ['tail'],
};

/** Места, с которых скрывается обшивка фюзеляжа и остекление: глаз внутри фюзеляжа. */
export const SHELL_HIDDEN_FROM: ReadonlySet<Station> = new Set<Station>(['pilot', 'copilot', 'navigator', 'radio', 'waist_gunner']);

/** Ось фюзеляжа (z центра сечения) и внутренние радиусы стенок отсеков — чуть меньше наружной обшивки. */
export const FUSELAGE_AXIS_Z = -0.1;

/** Отсек: границы по x, радиус стенки и окна — диапазоны угла θ (0 — верх, 90° — правый борт) на участке x. */
export type PodWalls = { x0: number; x1: number; r: number; open?: [number, number][]; windows?: { x0: number; x1: number; th0: number; th1: number }[] };

export const POD_WALLS: Record<PodName, PodWalls> = {
    // Кабина пилотов: верх открыт под фонарь (−70…70°), борта и низ — стенка.
    cockpit: { x0: 3.55, x1: 5.9, r: 0.84, open: [[-72, 72]] },
    // Штурман: окно в левом борту.
    navigator: { x0: 2.2, x1: 3.55, r: 0.86, windows: [{ x0: 2.75, x1: 3.3, th0: -118, th1: -68 }] },
    // Нос под остеклением — стенок нет (видна наружная модель), только пол и оборудование.
    nose: { x0: 6.35, x1: 6.35, r: 0.6 },
    // Турель — под куполом (наружная модель видна), стенок нет.
    turret: { x0: 1.9, x1: 1.9, r: 0.55 },
    // Радист и бортовые стрелки: окна в обоих бортах.
    waist: {
        x0: -5.0,
        x1: -2.4,
        r: 0.7,
        windows: [
            { x0: -4.15, x1: -3.05, th0: 48, th1: 118 },
            { x0: -4.15, x1: -3.05, th0: -118, th1: -48 },
        ],
    },
    // Хвост: стенки впереди остекления.
    tail: { x0: -7.6, x1: -6.6, r: 0.44 },
};

type Mats = Record<'wall' | 'floor' | 'frame' | 'metal' | 'seat' | 'paper' | 'dial' | 'lamp', THREE.Material>;

/** Сегмент трубы по оси x: θ от th0 до th1 (градусы, 0 — верх, +90 — правый борт), радиус r. Видна с обеих сторон. */
function tube(x0: number, x1: number, r: number, th0: number, th1: number): THREE.BufferGeometry {
    const steps = Math.max(2, Math.ceil(Math.abs(th1 - th0) / 8));
    const positions: number[] = [];
    const indices: number[] = [];

    for (let i = 0; i <= steps; i++) {
        const th = THREE.MathUtils.degToRad(th0 + ((th1 - th0) * i) / steps);
        const y = r * Math.sin(th);
        const z = FUSELAGE_AXIS_Z - r * Math.cos(th);

        positions.push(x0, y, z, x1, y, z);

        if (i > 0) {
            const k = i * 2;

            indices.push(k - 2, k - 1, k, k - 1, k + 1, k);
        }
    }

    const g = new THREE.BufferGeometry();

    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setIndex(indices);
    g.computeVertexNormals();

    return g;
}

/** Диапазоны θ стенки без вырезов: из полного круга [−180, 180] вычесть открытые. */
function closedRanges(open: [number, number][]): [number, number][] {
    const sorted = [...open].sort((a, b) => a[0] - b[0]);
    const out: [number, number][] = [];
    let from = -180;

    for (const [a, b] of sorted) {
        if (a > from) {
            out.push([from, a]);
        }

        from = Math.max(from, b);
    }

    if (from < 180) {
        out.push([from, 180]);
    }

    return out;
}

/** Поворот узла установки: азимут вокруг Z (вправо +), угол места вокруг Y (вверх +) — как mountDirectionBody. */
export function aimRig(rig: THREE.Object3D, az: number, el: number): void {
    rig.rotation.set(0, el, az, 'ZYX');
}

export type MountAim = { id: string; az: number; el: number };

export function createCrewInteriors(): {
    group: THREE.Group;
    pods: Record<PodName, THREE.Group>;
    show(station: Station | null): void;
    aim(mounts: readonly MountAim[]): void;
    dispose(): void;
} {
    const group = new THREE.Group();
    const disposables: { dispose(): void }[] = [];
    const lambert = (color: number, extra: THREE.MeshLambertMaterialParameters = {}): THREE.Material => {
        const m = new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide, ...extra });

        disposables.push(m);

        return m;
    };
    const mat: Mats = {
        wall: lambert(0x6f7a4a),
        floor: lambert(0x5b4b35),
        frame: lambert(0x2d3324),
        metal: lambert(0x25272a),
        seat: lambert(0x4a3426),
        paper: lambert(0xd9cfae),
        dial: lambert(0xe8e2c8, { emissive: 0x302c20 }),
        lamp: lambert(0xffd890, { emissive: 0xb08840 }),
    };
    const geo = <G extends THREE.BufferGeometry>(g: G): G => (disposables.push(g), g);
    const pods = {} as Record<PodName, THREE.Group>;

    const pod = (name: PodName): THREE.Group => {
        const g = new THREE.Group();

        g.name = `pod_${name}`;
        g.visible = false;
        pods[name] = g;
        group.add(g);

        return g;
    };
    const box = (parent: THREE.Group, w: number, d: number, h: number, m: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
        // w — по x (вдоль), d — по y (поперёк), h — по z (по вертикали).
        const mesh = new THREE.Mesh(geo(new THREE.BoxGeometry(w, d, h)), m);

        mesh.position.set(x, y, z);
        parent.add(mesh);

        return mesh;
    };
    const cylinderY = (parent: THREE.Group, r: number, length: number, m: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
        const mesh = new THREE.Mesh(geo(new THREE.CylinderGeometry(r, r, length, 10)), m);

        mesh.position.set(x, y, z);
        parent.add(mesh);

        return mesh;
    };
    const cylinderZ = (parent: THREE.Group, r: number, length: number, m: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
        const mesh = new THREE.Mesh(geo(new THREE.CylinderGeometry(r, r, length, 10)), m);

        mesh.rotation.x = Math.PI / 2;
        mesh.position.set(x, y, z);
        parent.add(mesh);

        return mesh;
    };
    /**
     * Переборка поперёк фюзеляжа на x: кольцо и закрытая дверь в проходе радиуса hole (нормаль — вдоль x). Дверь
     * тёмная и сплошная: за переборкой отсек не построен, сквозь проход было бы видно небо.
     */
    const bulkhead = (parent: THREE.Group, x: number, r: number, hole: number): void => {
        const ring = new THREE.Mesh(geo(new THREE.RingGeometry(hole, r, 24)), mat.wall);
        const door = new THREE.Mesh(geo(new THREE.CircleGeometry(hole, 20)), mat.frame);

        ring.rotation.y = Math.PI / 2;
        ring.position.set(x, 0, FUSELAGE_AXIS_Z);
        door.rotation.y = Math.PI / 2;
        door.position.set(x, 0, FUSELAGE_AXIS_Z);
        parent.add(ring, door);
    };
    /** Стенки отсека по описанию POD_WALLS: участки по x с окнами и без. */
    const walls = (parent: THREE.Group, spec: PodWalls): void => {
        if (spec.x1 <= spec.x0) {
            return;
        }

        const cuts = new Set<number>([spec.x0, spec.x1]);

        for (const w of spec.windows ?? []) {
            cuts.add(w.x0);
            cuts.add(w.x1);
        }

        const xs = [...cuts].sort((a, b) => a - b);

        for (let i = 1; i < xs.length; i++) {
            const a = xs[i - 1]!;
            const b = xs[i]!;
            const mid = (a + b) / 2;
            const open: [number, number][] = [...(spec.open ?? [])];

            for (const w of spec.windows ?? []) {
                if (mid > w.x0 && mid < w.x1) {
                    open.push([w.th0, w.th1]);
                }
            }

            for (const [th0, th1] of closedRanges(open)) {
                parent.add(new THREE.Mesh(geo(tube(a, b, spec.r, th0, th1)), mat.wall));
            }
        }

        // Рёбра шпангоутов по стенке — через ~0,45 м (сплошные дуги, кроме открытых сверху участков).
        for (let x = spec.x0 + 0.2; x < spec.x1 - 0.1; x += 0.45) {
            for (const [th0, th1] of closedRanges(spec.open ?? [])) {
                parent.add(new THREE.Mesh(geo(tube(x - 0.025, x + 0.025, spec.r - 0.03, th0, th1)), mat.frame));
            }
        }
    };
    /** Кресло: подушка и спинка; лицом к носу (dir = 1) или к хвосту (dir = −1). */
    const seat = (parent: THREE.Group, x: number, y: number, z: number, dir = 1): void => {
        box(parent, 0.45, 0.45, 0.08, mat.seat, x, y, z);
        box(parent, 0.08, 0.45, 0.55, mat.seat, x - dir * 0.24, y, z - 0.3);
    };
    /** Подвижные установки по id из gameplay_mounts: узел поворачивается по фактическим углам установки. */
    const rigs = new Map<string, THREE.Group>();

    /**
     * Пулемёт(ы) .50 на подвижной установке: узел на оси вращения `pivot`, стволы вдоль локальной +X со смещениями
     * `offsets` (спаренные — по y), казённик у оси. Положение покоя — центр сектора установки.
     */
    const gunRig = (parent: THREE.Group, mountId: string, pivot: [number, number, number], length: number, offsets: [number, number][], restAz = 0): THREE.Group => {
        const rig = new THREE.Group();

        for (const [dy, dz] of offsets) {
            const barrel = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.025, 0.03, length, 8)), mat.metal);
            const breech = new THREE.Mesh(geo(new THREE.BoxGeometry(0.3, 0.1, 0.12)), mat.metal);

            barrel.rotation.z = -Math.PI / 2;
            barrel.position.set(0.2 + length / 2, dy, dz);
            breech.position.set(0, dy, dz);
            rig.add(barrel, breech);
        }

        rig.name = `gun_${mountId}`;
        rig.position.set(...pivot);
        aimRig(rig, restAz, 0);
        parent.add(rig);
        rigs.set(mountId, rig);

        return rig;
    };

    // ── Кабина пилотов.
    {
        const p = pod('cockpit');

        walls(p, POD_WALLS.cockpit);

        // Передний торец под приборной доской — нижняя половина переборки (верх открыт: лобовое стекло). Кольцо
        // после поворота на 90° вокруг Y локальная +X смотрит вверх (−Z FRD), −X — вниз, поэтому сектор π/2…3π/2.
        const front = new THREE.Mesh(geo(new THREE.CircleGeometry(POD_WALLS.cockpit.r, 24, Math.PI / 2, Math.PI)), mat.wall);

        front.rotation.y = Math.PI / 2;
        front.position.set(POD_WALLS.cockpit.x1, 0, FUSELAGE_AXIS_Z);
        p.add(front);
        box(p, 2.3, 1.3, 0.04, mat.floor, 4.7, 0, 0.36);

        for (const y of [-0.45, 0.45]) {
            seat(p, 4.4, y, 0.12);
            // Штурвальная колонка и штурвал перед креслом.
            cylinderZ(p, 0.03, 0.62, mat.metal, 5.05, y, 0.05);

            // Полный обод штурвала с перекладиной — в плоскости поперёк фюзеляжа (YZ).
            const wheel = new THREE.Mesh(geo(new THREE.TorusGeometry(0.16, 0.018, 6, 28)), mat.metal);

            wheel.rotation.set(0, Math.PI / 2, 0);
            wheel.position.set(5.0, y, -0.28);
            p.add(wheel);
            box(p, 0.05, 0.32, 0.03, mat.metal, 5.0, y, -0.28);
            // Педали.
            box(p, 0.06, 0.1, 0.18, mat.metal, 5.35, y - 0.12, 0.25);
            box(p, 0.06, 0.1, 0.18, mat.metal, 5.35, y + 0.12, 0.25);
            // Бортовые пульты.
            box(p, 0.9, 0.18, 0.06, mat.frame, 4.55, y * 1.7, -0.05);
        }

        // Центральный пульт с рычагами газа и шага винтов.
        box(p, 0.55, 0.26, 0.4, mat.frame, 5.05, 0, 0.12);

        for (let i = 0; i < 6; i++) {
            const lever = cylinderZ(p, 0.012, 0.18, mat.metal, 5.0 + (i % 2) * 0.06, -0.09 + i * 0.036, -0.15);

            lever.rotation.y = -0.3;
        }

        box(p, 0.05, 0.05, 0.05, mat.lamp, 5.2, 0, -0.1);
    }

    // ── Штурман.
    {
        const p = pod('navigator');

        walls(p, POD_WALLS.navigator);
        // Задняя переборка отсека (за ней — бомбоотсек): без неё сквозь открытый торец было видно хвост и небо.
        bulkhead(p, POD_WALLS.navigator.x0, POD_WALLS.navigator.r, 0.3);
        box(p, 1.35, 1.3, 0.04, mat.floor, 2.88, 0, 0.38);
        // Стол с картой и лампой — перед креслом, на уровне колен.
        box(p, 0.5, 0.46, 0.04, mat.frame, 3.85, 0, 0.02);
        box(p, 0.42, 0.38, 0.005, mat.paper, 3.85, 0, -0.005);
        cylinderZ(p, 0.015, 0.25, mat.metal, 3.65, 0.2, -0.13);
        box(p, 0.08, 0.06, 0.05, mat.lamp, 3.7, 0.2, -0.27);
        seat(p, 3.1, 0, 0.14);
        // Стойка с приборами штурмана на правом борту.
        box(p, 0.4, 0.12, 0.35, mat.frame, 3.2, 0.68, -0.25);

        for (let i = 0; i < 3; i++) {
            cylinderY(p, 0.05, 0.01, mat.dial, 3.07 + i * 0.13, 0.61, -0.28);
        }
    }

    // ── Нос: бомбардир.
    {
        const p = pod('nose');

        box(p, 0.95, 0.75, 0.04, mat.floor, 6.85, 0, 0.36);
        // Прицел (корпус и окуляр) — перед и под глазом.
        box(p, 0.2, 0.15, 0.18, mat.metal, 7.28, 0, 0.29);
        cylinderZ(p, 0.025, 0.1, mat.metal, 7.24, 0, 0.17);
        box(p, 0.12, 0.3, 0.06, mat.frame, 7.15, 0, 0.34);
        seat(p, 6.75, 0, 0.24);
        // Курсовой подвижный пулемёт — ствол наружной модели (бомбардир под остеклением, она ему видна); казённик в
        // отсеке не ставим: он оказывался в 15 см от глаза и закрывал полэкрана.
        // Переборка за спиной с проходом и стойка с бомбосбрасывателем.
        bulkhead(p, 6.35, 0.62, 0.28);
        box(p, 0.08, 0.14, 0.3, mat.frame, 6.5, -0.42, 0.05);
    }

    // ── Верхняя турель.
    {
        const p = pod('turret');
        const ring = new THREE.Mesh(geo(new THREE.TorusGeometry(0.52, 0.04, 6, 28)), mat.metal);

        ring.position.set(1.9, 0, -0.92);
        p.add(ring);

        // Спаренные пулемёты, прицел и рукоятки поворачиваются вместе с турелью вокруг её центра.
        const turret = gunRig(p, 'top_turret', [1.9, 0, -1.02], 0.9, [
            [-0.24, 0],
            [0.24, 0],
        ]);

        box(turret, 0.04, 0.03, 0.04, mat.metal, 0.3, 0, -0.13);
        box(turret, 0.05, 0.42, 0.04, mat.frame, 0.18, 0, 0.07);
        seat(p, 1.7, 0, -0.55);
        // Рёбра купола изнутри.
        for (const a of [0, Math.PI / 2]) {
            const rib = new THREE.Mesh(geo(new THREE.TorusGeometry(0.53, 0.012, 4, 20, Math.PI)), mat.frame);

            rib.rotation.set(Math.PI / 2, a, 0);
            rib.position.set(1.9, 0, -0.9);
            p.add(rib);
        }
    }

    // ── Радист и бортовые стрелки.
    {
        const p = pod('waist');

        walls(p, POD_WALLS.waist);
        box(p, 2.6, 1.05, 0.04, mat.floor, -3.7, 0, 0.36);
        bulkhead(p, -2.4, 0.72, 0.3);
        bulkhead(p, -5.0, 0.66, 0.25);
        // Бортовые пулемёты в окнах — стволами наружу.
        gunRig(p, 'waist_right', [-3.35, 0.52, -0.18], 0.9, [[0, 0]], Math.PI / 2);
        gunRig(p, 'waist_left', [-3.35, -0.52, -0.18], 0.9, [[0, 0]], -Math.PI / 2);
        // Ящики с лентами.
        box(p, 0.3, 0.22, 0.25, mat.frame, -3.95, 0.38, 0.22);
        box(p, 0.3, 0.22, 0.25, mat.frame, -3.95, -0.38, 0.22);
        // Радиостанция у левого борта впереди: стойки со шкалами и стол.
        box(p, 0.55, 0.26, 0.6, mat.frame, -2.75, -0.45, -0.1);

        for (let i = 0; i < 4; i++) {
            cylinderY(p, 0.045, 0.01, mat.dial, -2.92 + (i % 2) * 0.2, -0.31, -0.28 + Math.floor(i / 2) * 0.18);
        }

        box(p, 0.05, 0.05, 0.05, mat.lamp, -2.6, -0.31, -0.33);
        box(p, 0.45, 0.4, 0.04, mat.floor, -3.1, -0.35, 0.05);
        seat(p, -3.45, -0.32, 0.18);
    }

    // ── Хвост.
    {
        const p = pod('tail');

        walls(p, POD_WALLS.tail);
        bulkhead(p, -6.6, 0.48, 0.2);
        box(p, 0.8, 0.5, 0.04, mat.floor, -8.0, 0, 0.18);

        // Спаренные пулемёты — стволами назад.
        // Спаренные хвостовые пулемёты с прицелом — на одной установке.
        const tail = gunRig(p, 'tail', [-8.6, 0, 0], 0.8, [
            [-0.1, 0],
            [0.1, 0],
        ], Math.PI);

        box(tail, 0.06, 0.05, 0.06, mat.metal, 0.1, 0, -0.16);
        seat(p, -8.1, 0, 0.1, -1);
    }

    return {
        group,
        pods,
        aim: (mounts) => {
            for (const m of mounts) {
                const rig = rigs.get(m.id);

                if (rig) {
                    aimRig(rig, m.az, m.el);
                }
            }
        },
        show: (station) => {
            const visible = new Set(station === null ? [] : PODS_FOR_STATION[station]);

            for (const [name, g] of Object.entries(pods) as [PodName, THREE.Group][]) {
                g.visible = visible.has(name);
            }
        },
        dispose: () => disposables.forEach((d) => d.dispose()),
    };
}
