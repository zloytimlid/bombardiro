import * as THREE from 'three';

/**
 * Временная модель B-25J из примитивов в осях FRD (x вперёд, y вправо, z вниз), метры от ЦМ.
 * Итоговая glTF-модель с ливреей — этап 4. Рисунок на носу не воспроизводится: слот `nose_art`.
 */
export type AircraftModel = {
    root: THREE.Group;
    propellers: THREE.Object3D[];
    gear: THREE.Object3D[];
    /** Части, скрываемые в виде из кабины (иначе загораживают обзор изнутри). */
    exteriorOnly: THREE.Object3D[];
    noseArtSlot: THREE.Mesh;
    dispose(): void;
};

const OLIVE = 0x4f5a34;
const GREY = 0x8d9296;

function nameplateTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');

    canvas.width = 512;
    canvas.height = 128;

    const ctx = canvas.getContext('2d');

    if (ctx) {
        ctx.fillStyle = '#4f5a34';
        ctx.fillRect(0, 0, 512, 128);
        ctx.fillStyle = '#f2efe4';
        ctx.font = 'italic bold 44px serif';
        ctx.textAlign = 'center';
        ctx.fillText('Lil Critter from the Moon', 256, 60);
        ctx.font = 'bold 34px sans-serif';
        ctx.fillText('8U  ·  43-4064', 256, 108);
    }

    const texture = new THREE.CanvasTexture(canvas);

    texture.colorSpace = THREE.SRGBColorSpace;

    return texture;
}

export function createAircraftModel(): AircraftModel {
    const root = new THREE.Group();
    const geometries: THREE.BufferGeometry[] = [];
    const materials: THREE.Material[] = [];
    const add = <T extends THREE.BufferGeometry>(g: T): T => (geometries.push(g), g);
    const mat = <T extends THREE.Material>(m: T): T => (materials.push(m), m);

    const olive = mat(new THREE.MeshStandardMaterial({ color: OLIVE, roughness: 0.85, metalness: 0.1 }));
    const grey = mat(new THREE.MeshStandardMaterial({ color: GREY, roughness: 0.8, metalness: 0.1 }));
    const glass = mat(new THREE.MeshStandardMaterial({ color: 0x9fc4d8, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.35 }));
    const dark = mat(new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6 }));
    const exteriorOnly: THREE.Object3D[] = [];

    const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
        const m = new THREE.Mesh(geometry, material);

        m.position.set(x, y, z);
        m.castShadow = true;
        root.add(m);

        return m;
    };

    // Фюзеляж вдоль x (цилиндр Three.js — вдоль своей оси Y).
    const fuselage = mesh(add(new THREE.CylinderGeometry(0.85, 0.55, 15.2, 18)), olive, -0.9, 0, -0.1);

    fuselage.rotation.z = Math.PI / 2;
    exteriorOnly.push(fuselage);

    const belly = mesh(add(new THREE.BoxGeometry(13, 1.2, 0.4)), grey, -0.5, 0, 0.6);

    exteriorOnly.push(belly);

    // Остеклённый нос бомбардира.
    const nose = mesh(add(new THREE.SphereGeometry(0.85, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2)), glass, 6.7, 0, -0.1);

    nose.rotation.z = -Math.PI / 2;

    // Кабина пилотов — фонарь.
    const canopy = mesh(add(new THREE.BoxGeometry(2.2, 1.5, 0.6)), glass, 4.6, 0, -0.95);

    exteriorOnly.push(canopy);

    // Крыло, стабилизатор, два киля.
    mesh(add(new THREE.BoxGeometry(3.0, 20.6, 0.32)), olive, 0.2, 0, 0.25);
    mesh(add(new THREE.BoxGeometry(1.8, 7.0, 0.2)), olive, -8.4, 0, -0.35);

    for (const side of [-1, 1]) {
        mesh(add(new THREE.BoxGeometry(1.5, 0.15, 2.6)), olive, -8.7, side * 3.4, -1.3);
    }

    // Мотогондолы и винты.
    const propellers: THREE.Object3D[] = [];
    const propGeometry = add(new THREE.BoxGeometry(0.12, 3.8, 0.22));

    for (const side of [-1, 1]) {
        const nacelle = mesh(add(new THREE.CylinderGeometry(0.72, 0.55, 5.2, 16)), olive, 0.9, side * 2.97, 0.15);

        nacelle.rotation.z = Math.PI / 2;

        const hub = new THREE.Group();

        hub.position.set(3.6, side * 2.97, 0.15);

        for (let i = 0; i < 3; i++) {
            const blade = new THREE.Mesh(propGeometry, dark);

            blade.rotation.x = (i * Math.PI * 2) / 3;
            hub.add(blade);
        }

        root.add(hub);
        propellers.push(hub);
    }

    // Верхняя турель.
    const turret = mesh(add(new THREE.SphereGeometry(0.6, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2)), glass, 2.6, 0, -0.85);

    turret.rotation.x = Math.PI;

    // Шасси: стойки и колёса.
    const gear: THREE.Object3D[] = [];
    const wheelGeometry = add(new THREE.CylinderGeometry(0.55, 0.55, 0.35, 16));
    const strutGeometry = add(new THREE.CylinderGeometry(0.08, 0.08, 1.6, 8));

    for (const [x, y] of [
        [4.5, 0],
        [-0.45, -2.97],
        [-0.45, 2.97],
    ] as const) {
        const leg = new THREE.Group();
        const strut = new THREE.Mesh(strutGeometry, dark);
        const wheel = new THREE.Mesh(wheelGeometry, dark);

        strut.rotation.x = Math.PI / 2;
        strut.position.z = 0.8;
        wheel.position.z = 1.55;
        leg.add(strut, wheel);
        leg.position.set(x, y, 0.1);
        root.add(leg);
        gear.push(leg);
    }

    // Надпись и код по фото; слот под рисунок заказчика (раздел 3, «Ливрея и права»).
    const plate = mat(new THREE.MeshStandardMaterial({ map: nameplateTexture(), roughness: 0.8 }));
    const nameplate = mesh(add(new THREE.PlaneGeometry(2.4, 0.6)), plate, 5.2, -0.86, -0.1);

    // Левый борт: нормаль -y, «вверх» текста -z, читается от носа к хвосту.
    nameplate.setRotationFromMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, -1, 0)));
    exteriorOnly.push(nameplate);

    const noseArtSlot = mesh(add(new THREE.PlaneGeometry(1.2, 1.0)), mat(new THREE.MeshStandardMaterial({ color: OLIVE, roughness: 0.9 })), 5.6, 0.86, 0.1);

    noseArtSlot.name = 'nose_art';
    noseArtSlot.setRotationFromMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0)));
    exteriorOnly.push(noseArtSlot);

    return {
        root,
        propellers,
        gear,
        exteriorOnly,
        noseArtSlot,
        dispose: () => {
            geometries.forEach((g) => g.dispose());
            materials.forEach((m) => m.dispose());
        },
    };
}
