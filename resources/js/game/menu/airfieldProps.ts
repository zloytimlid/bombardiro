import * as THREE from 'three';

/**
 * Постройки аэродрома для фона главного меню: ангары, бараки, вышки, склады горючего и бомб, капониры,
 * зенитные позиции, палаточный лагерь, машины, ветроуказатель и маркеры кромки полосы. Чисто декоративная
 * процедурная геометрия (source: gameplay) — не реконструкция конкретного аэродрома.
 *
 * Расстановка — в осях полосы: along — метры от торца по курсу, across — вправо (минус — слева, где стоянка
 * и рулёжки). Таблица отдельно от геометрии, чтобы тест проверял, что ничего не стоит на полосе и путях руления.
 */
export type PropKind =
    | 'hangar'
    | 'hut'
    | 'mast'
    | 'water_tower'
    | 'windsock'
    | 'truck'
    | 'jeep'
    | 'fuel_dump'
    | 'bomb_dump'
    | 'revetment'
    | 'aa_pit'
    | 'tent_camp';

/** Объект расстановки: место, курс относительно полосы (рад, вправо — плюс) и радиус, который он занимает. */
export type PropPlacement = { kind: PropKind; along: number; across: number; yaw: number; radius: number };

export const AIRFIELD_LAYOUT: PropPlacement[] = [
    // Справа от полосы — служебная зона: её видно в правой части кадра, не за меню.
    { kind: 'windsock', along: 70, across: 45, yaw: 0, radius: 2 },
    { kind: 'aa_pit', along: 150, across: 95, yaw: 0, radius: 6 },
    { kind: 'fuel_dump', along: 225, across: 72, yaw: 0, radius: 9 },
    { kind: 'truck', along: 252, across: 66, yaw: 0.3, radius: 4 },
    { kind: 'jeep', along: 300, across: 82, yaw: 1.2, radius: 3 },
    { kind: 'hangar', along: 360, across: 120, yaw: -Math.PI / 2, radius: 20 },
    { kind: 'hangar', along: 430, across: 120, yaw: -Math.PI / 2, radius: 20 },
    { kind: 'jeep', along: 475, across: 92, yaw: -0.6, radius: 3 },
    { kind: 'hut', along: 520, across: 100, yaw: 0, radius: 6 },
    { kind: 'hut', along: 545, across: 104, yaw: 0.05, radius: 6 },
    { kind: 'hut', along: 570, across: 100, yaw: 0, radius: 6 },
    { kind: 'mast', along: 600, across: 128, yaw: 0, radius: 2 },
    { kind: 'water_tower', along: 660, across: 150, yaw: 0, radius: 4 },
    { kind: 'truck', along: 700, across: 88, yaw: 2.4, radius: 4 },
    { kind: 'bomb_dump', along: 780, across: 122, yaw: 0, radius: 12 },
    { kind: 'tent_camp', along: 950, across: 150, yaw: 0, radius: 22 },
    { kind: 'aa_pit', along: 1150, across: 90, yaw: 0, radius: 6 },
    // Слева — у стоянки: капониры за стоящими самолётами, топливозаправщик, джип у вышки, зенитка в конце.
    { kind: 'revetment', along: 290, across: -82, yaw: 0.9, radius: 22 },
    { kind: 'revetment', along: 340, across: -95, yaw: 1.05, radius: 22 },
    { kind: 'revetment', along: 395, across: -86, yaw: 0.8, radius: 22 },
    { kind: 'truck', along: 318, across: -60, yaw: 0.2, radius: 4 },
    { kind: 'jeep', along: 455, across: -100, yaw: 0.4, radius: 3 },
    { kind: 'aa_pit', along: 1300, across: -90, yaw: 0, radius: 6 },
];

export type VehicleKind = 'truck' | 'jeep';

/**
 * Машина (стоящая или едущая): грузовик — кабина, кузов, колёса; джип — кузов, ветровое стекло, колёса.
 * Локальная −Z — вперёд. Свои геометрии и материалы — освобождаются dispose().
 */
export function createVehicleModel(kind: VehicleKind): { root: THREE.Object3D; dispose(): void } {
    const owned: { dispose(): void }[] = [];
    const olive = new THREE.MeshLambertMaterial({ color: 0x4b5320 });
    const dark = new THREE.MeshLambertMaterial({ color: 0x2a2a28 });
    const steel = new THREE.MeshLambertMaterial({ color: 0x6d6f6a });
    const root = new THREE.Group();
    const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number): void => {
        const g = new THREE.BoxGeometry(w, h, d);
        const mesh = new THREE.Mesh(g, m);

        owned.push(g);
        mesh.position.set(x, y, z);
        root.add(mesh);
    };

    owned.push(olive, dark, steel);

    if (kind === 'truck') {
        box(2.3, 2.1, 1.9, olive, 0, 1.6, -2.6);
        box(2.4, 1.7, 4.6, olive, 0, 1.55, 0.9);

        for (const z of [-1.85, 1.9]) {
            for (const x of [-1.15, 1.15]) {
                box(0.35, 1, 1, dark, x, 0.5, z);
            }
        }
    } else {
        box(1.5, 0.8, 3.3, olive, 0, 0.75, 0);
        box(1.4, 0.6, 0.06, steel, 0, 1.45, -0.4);

        for (const z of [-1.1, 1.1]) {
            for (const x of [-0.75, 0.75]) {
                box(0.25, 0.65, 0.65, dark, x, 0.33, z);
            }
        }
    }

    return { root, dispose: () => owned.forEach((o) => o.dispose()) };
}

/** Ставит объект на землю в точке полосы и поворачивает: локальная −Z — «вперёд» по курсу полосы + yaw, +X — вправо. */
export type Placer = (obj: THREE.Object3D, along: number, across: number, yaw?: number) => void;

type Materials = Record<'olive' | 'iron' | 'wood' | 'roof' | 'earth' | 'sandbag' | 'canvas' | 'dark' | 'orange' | 'white' | 'drum' | 'bomb' | 'steel', THREE.Material>;

export function buildAirfield(scene: THREE.Scene, place: Placer, runwayLength: number): { dispose(): void } {
    const disposables: { dispose(): void }[] = [];
    const lambert = (color: number): THREE.MeshLambertMaterial => {
        const m = new THREE.MeshLambertMaterial({ color });

        disposables.push(m);

        return m;
    };
    const mat: Materials = {
        olive: lambert(0x4b5320),
        iron: lambert(0x7a7d72),
        wood: lambert(0x8a6f4d),
        roof: lambert(0x5a4a3a),
        earth: lambert(0x7d6b4c),
        sandbag: lambert(0xa3906a),
        canvas: lambert(0x6b6a4a),
        dark: lambert(0x2a2a28),
        orange: new THREE.MeshLambertMaterial({ color: 0xd8772a, side: THREE.DoubleSide }),
        white: lambert(0xe6e2d6),
        drum: lambert(0x55603f),
        bomb: lambert(0x3d4732),
        steel: lambert(0x6d6f6a),
    };

    disposables.push(mat.orange);
    const geo = <G extends THREE.BufferGeometry>(g: G): G => {
        disposables.push(g);

        return g;
    };
    const box = (w: number, h: number, d: number, m: THREE.Material, x = 0, y = h / 2, z = 0): THREE.Mesh => {
        const mesh = new THREE.Mesh(geo(new THREE.BoxGeometry(w, h, d)), m);

        mesh.position.set(x, y, z);

        return mesh;
    };
    const group = (...children: THREE.Object3D[]): THREE.Group => {
        const g = new THREE.Group();

        g.add(...children);

        return g;
    };

    const vehicle = (kind: VehicleKind): THREE.Object3D => {
        const v = createVehicleModel(kind);

        disposables.push(v);

        return v.root;
    };

    const builders: Record<Exclude<PropKind, 'fuel_dump' | 'bomb_dump' | 'tent_camp'>, () => THREE.Object3D> = {
        // Арочный ангар из гофрированного железа: цилиндр наполовину в земле, торец с тёмными воротами — к полосе.
        hangar: () => {
            const shell = new THREE.Mesh(geo(new THREE.CylinderGeometry(11, 11, 36, 20)), mat.iron);

            shell.rotation.x = Math.PI / 2;

            return group(shell, box(12, 7, 0.4, mat.dark, 0, 3.5, -18.1));
        },
        // Деревянный барак с двускатной крышей (треугольная призма: ребро вверх, ось — вдоль барака).
        hut: () => {
            const roof = new THREE.Mesh(geo(new THREE.CylinderGeometry(3.4, 3.4, 13, 3)), mat.roof);

            roof.rotation.x = -Math.PI / 2;
            roof.position.y = 3 + 1.7;

            return group(box(5.8, 3, 12, mat.wood), roof, box(1.1, 2, 0.2, mat.dark, 0, 1, -6.05));
        },
        // Радиомачта с будкой.
        mast: () => {
            const pole = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.12, 0.25, 22, 6)), mat.steel);

            pole.position.y = 11;

            return group(pole, box(2.5, 2.4, 2.5, mat.wood, 3, 1.2, 0));
        },
        // Водонапорная башня: четыре опоры и бак.
        water_tower: () => {
            const tank = new THREE.Mesh(geo(new THREE.CylinderGeometry(2.6, 2.6, 3.2, 12)), mat.steel);

            tank.position.y = 11.6;

            return group(
                tank,
                ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => box(0.35, 10, 0.35, mat.wood, sx * 1.9, 5, sz * 1.9))),
            );
        },
        // Ветроуказатель: шест и полосатый «чулок» по ветру.
        windsock: () => {
            const pole = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.06, 0.08, 6, 6)), mat.white);
            const sock = new THREE.Mesh(geo(new THREE.ConeGeometry(0.55, 3, 10, 1, true)), mat.orange);

            pole.position.y = 3;
            sock.rotation.z = Math.PI / 2 + 0.25;
            sock.position.set(1.5, 5.6, 0);

            return group(pole, sock);
        },
        truck: () => vehicle('truck'),
        jeep: () => vehicle('jeep'),
        // Капонир: земляной вал буквой П за стоящим самолётом (открыт к рулёжке).
        revetment: () =>
            group(
                box(34, 2.4, 2.5, mat.earth, 0, 1.2, 13),
                box(2.5, 2.2, 16, mat.earth, -16.5, 1.1, 5),
                box(2.5, 2.2, 16, mat.earth, 16.5, 1.1, 5),
            ),
        // Зенитная позиция: кольцо мешков с песком и ствол, задранный вверх.
        aa_pit: () => {
            const ring = new THREE.Mesh(geo(new THREE.TorusGeometry(4.2, 0.7, 6, 18)), mat.sandbag);
            const barrel = box(0.25, 0.25, 4.5, mat.dark, 0, 2.6, -0.6);

            ring.rotation.x = Math.PI / 2;
            ring.position.y = 0.5;
            barrel.rotation.x = 0.7;

            return group(ring, box(1.4, 1.2, 1.4, mat.steel, 0, 1, 0), barrel);
        },
    };

    // Повторяющиеся мелкие объекты — одним InstancedMesh на вид (бочки, бомбы, палатки, маркеры полосы).
    const dummy = new THREE.Object3D();
    const instanced = (geometry: THREE.BufferGeometry, material: THREE.Material, spots: { along: number; across: number; yaw: number; y: number; tilt?: number }[]): void => {
        const mesh = new THREE.InstancedMesh(geo(geometry), material, spots.length);

        spots.forEach((s, i) => {
            place(dummy, s.along, s.across, s.yaw);
            dummy.position.y += s.y;
            dummy.rotation.z = s.tilt ?? 0;
            dummy.updateMatrix();
            mesh.setMatrixAt(i, dummy.matrix);
            dummy.rotation.z = 0;
        });
        mesh.instanceMatrix.needsUpdate = true;
        scene.add(mesh);
    };

    for (const p of AIRFIELD_LAYOUT) {
        if (p.kind === 'fuel_dump') {
            // Штабели бочек с горючим: 4 ряда по 6, местами в два яруса.
            const spots = [];

            for (let r = 0; r < 4; r++) {
                for (let c = 0; c < 6; c++) {
                    spots.push({ along: p.along + c * 1.4 - 3.5, across: p.across + r * 1.4 - 2, yaw: 0, y: 0.45 });

                    if ((r + c) % 3 === 0) {
                        spots.push({ along: p.along + c * 1.4 - 3.5, across: p.across + r * 1.4 - 2, yaw: 0, y: 1.35 });
                    }
                }
            }

            instanced(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 8), mat.drum, spots);
            continue;
        }

        if (p.kind === 'bomb_dump') {
            // Склад бомб: штабели лежащих бомб за валом из мешков с песком.
            const spots = [];

            for (let stack = 0; stack < 3; stack++) {
                for (let layer = 0; layer < 3; layer++) {
                    for (let k = 0; k < 5 - layer; k++) {
                        spots.push({ along: p.along + stack * 6 - 6, across: p.across + k * 0.5 + layer * 0.25 - 1, yaw: Math.PI / 2, y: 0.25 + layer * 0.42, tilt: Math.PI / 2 });
                    }
                }
            }

            instanced(new THREE.CylinderGeometry(0.21, 0.21, 1.6, 8), mat.bomb, spots);

            for (const [da, dc, w, d] of [
                [0, -5, 22, 1.4],
                [0, 5, 22, 1.4],
                [-11, 0, 1.4, 11],
            ] as const) {
                const wall = box(w, 1.6, d, mat.sandbag);

                place(wall, p.along + da, p.across + dc, 0);
                scene.add(wall);
            }

            continue;
        }

        if (p.kind === 'tent_camp') {
            // Палаточный лагерь: 4 ряда по 7 палаток.
            const spots = [];

            for (let r = 0; r < 4; r++) {
                for (let c = 0; c < 7; c++) {
                    spots.push({ along: p.along + c * 12 - 36, across: p.across + r * 10 - 15, yaw: Math.PI / 4, y: 1.8 });
                }
            }

            instanced(new THREE.ConeGeometry(3.2, 3.6, 4), mat.canvas, spots);
            continue;
        }

        const obj = builders[p.kind]();

        place(obj, p.along, p.across, p.yaw);
        scene.add(obj);
    }

    // Маркеры кромки полосы — белые щиты через 75 м по обеим сторонам.
    const markers = [];

    for (let a = 0; a <= runwayLength; a += 75) {
        for (const side of [-1, 1]) {
            markers.push({ along: a, across: side * 25.5, yaw: 0, y: 0.3 });
        }
    }

    instanced(new THREE.BoxGeometry(1.2, 0.6, 0.4), mat.white, markers);

    return {
        dispose: () => disposables.forEach((d) => d.dispose()),
    };
}
