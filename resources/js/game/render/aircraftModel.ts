import * as THREE from 'three';

/**
 * Модель B-25J (этап 4) — процедурная, без сторонних ассетов: фюзеляж — тело вращения по профилю,
 * крыло «чайка» (поперечное V центроплана и обратное V консолей), мотогондолы с капотами, два овальных киля,
 * остеклённый нос, верхняя турель, хвостовая и бортовые точки, шасси.
 * Оси FRD (x вперёд, y вправо, z вниз), метры от ЦМ. Размеры — по общим данным B-25J (длина 16,1 м,
 * размах 20,6 м); форма — игровая, TODO(history): сверить по чертежам.
 * Ливрея — оливковый верх и серый низ (стандарт ВВС США 1943–44, source: gameplay), опознавательные
 * знаки ВВС США (общественное достояние), надпись и код — из конфигурации борта.
 * Рисунок на носу не воспроизводится: слот `nose_art`, текстуру даёт заказчик (`setNoseArt`).
 */
export type AircraftModel = {
    root: THREE.Group;
    propellers: THREE.Object3D[];
    gear: THREE.Object3D[];
    /** Части, скрываемые в виде из кабины (иначе загораживают обзор изнутри). */
    exteriorOnly: THREE.Object3D[];
    noseArtSlot: THREE.Mesh;
    /** Подставить рисунок заказчика в слот nose_art (URL картинки с прозрачностью). */
    setNoseArt(url: string | null): void;
    dispose(): void;
};

export type AircraftMarkings = { name: string; serial: string; code: string };

const OLIVE = new THREE.Color(0x4f5a34);
const GREY = new THREE.Color(0x8d9296);
const DEFAULT_MARKINGS: AircraftMarkings = { name: 'Lil Critter from the Moon', serial: '43-4064', code: '8U' };

function canvasTexture(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');

    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');

    if (ctx) {
        draw(ctx);
    }

    const texture = new THREE.CanvasTexture(canvas);

    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;

    return texture;
}

function nameplateTexture(m: AircraftMarkings): THREE.CanvasTexture {
    return canvasTexture(512, 128, (ctx) => {
        ctx.clearRect(0, 0, 512, 128);
        ctx.fillStyle = '#f2efe4';
        ctx.font = 'italic bold 44px serif';
        ctx.textAlign = 'center';
        ctx.fillText(m.name, 256, 60);
        ctx.font = 'bold 34px sans-serif';
        ctx.fillText(`${m.code}  ·  ${m.serial}`, 256, 108);
    });
}

/** Опознавательный знак ВВС США 1943–47: белая звезда в синем круге, белые полосы с синей каймой. */
function insigniaTexture(): THREE.CanvasTexture {
    return canvasTexture(512, 256, (ctx) => {
        const blue = '#22305e';

        ctx.clearRect(0, 0, 512, 256);
        ctx.fillStyle = blue;
        ctx.fillRect(40, 92, 432, 72);
        ctx.fillStyle = '#f5f5f0';
        ctx.fillRect(48, 100, 416, 56);
        ctx.fillStyle = blue;
        ctx.beginPath();
        ctx.arc(256, 128, 100, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#f5f5f0';
        ctx.beginPath();

        for (let i = 0; i < 10; i++) {
            const r = i % 2 === 0 ? 96 : 37;
            const a = -Math.PI / 2 + (i * Math.PI) / 5;

            ctx.lineTo(256 + r * Math.cos(a), 128 + r * Math.sin(a));
        }

        ctx.closePath();
        ctx.fill();
    });
}

/** Окраска по высоте вершины: оливковый верх, серый низ, размытая граница. */
function paint(geometry: THREE.BufferGeometry, worldZ: (z: number) => number, boundary = 0.15): THREE.BufferGeometry {
    const pos = geometry.getAttribute('position');
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
        const z = worldZ(pos.getZ(i));
        const t = THREE.MathUtils.smoothstep(z, boundary - 0.12, boundary + 0.12);

        c.copy(OLIVE).lerp(GREY, t);
        colors.set([c.r, c.g, c.b], i * 3);
    }

    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    return geometry;
}

/** Тело вращения вдоль оси x по профилю [x, радиус]. */
function bodyOfRevolution(profile: [number, number][], segments: number): THREE.BufferGeometry {
    const points = profile.map(([x, r]) => new THREE.Vector2(r, x));
    const g = new THREE.LatheGeometry(points, segments);

    // Lathe — вдоль оси Y и вокруг неё; поворачиваем: Y → X.
    g.rotateZ(-Math.PI / 2);

    return g;
}

/** Крыло или оперение: трапеция в плоскости XY с толщиной, хорды по корню и концу. */
function panel(rootChord: number, tipChord: number, span: number, thickness: number, sweepX = 0): THREE.BufferGeometry {
    const shape = new THREE.Shape();

    shape.moveTo(rootChord * 0.3, 0);
    shape.lineTo(tipChord * 0.3 + sweepX, span);
    shape.lineTo(-tipChord * 0.7 + sweepX, span);
    shape.lineTo(-rootChord * 0.7, 0);
    shape.closePath();

    const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: true, bevelThickness: thickness * 0.35, bevelSize: thickness * 0.4, bevelSegments: 2 });

    g.translate(0, 0, -thickness / 2);

    return g;
}

export function createAircraftModel(markings: AircraftMarkings = DEFAULT_MARKINGS): AircraftModel {
    const root = new THREE.Group();
    const geometries: THREE.BufferGeometry[] = [];
    const materials: THREE.Material[] = [];
    const textures: THREE.Texture[] = [];
    const add = <T extends THREE.BufferGeometry>(g: T): T => (geometries.push(g), g);
    const mat = <T extends THREE.Material>(m: T): T => (materials.push(m), m);

    const painted = mat(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.08 }));
    const olive = mat(new THREE.MeshStandardMaterial({ color: OLIVE, roughness: 0.85, metalness: 0.08 }));
    const glass = mat(new THREE.MeshStandardMaterial({ color: 0x9fc4d8, roughness: 0.08, metalness: 0.3, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
    const frame = mat(new THREE.MeshStandardMaterial({ color: 0x3d4529, roughness: 0.7 }));
    const dark = mat(new THREE.MeshStandardMaterial({ color: 0x1e1e1e, roughness: 0.6, metalness: 0.3 }));
    const exhaust = mat(new THREE.MeshStandardMaterial({ color: 0x3a2f28, roughness: 0.9 }));
    const exteriorOnly: THREE.Object3D[] = [];

    const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, exterior = true): THREE.Mesh => {
        const m = new THREE.Mesh(geometry, material);

        m.position.set(x, y, z);
        m.castShadow = true;
        root.add(m);

        if (exterior) {
            exteriorOnly.push(m);
        }

        return m;
    };

    // ── Фюзеляж: профиль от хвостовой точки (x = −8,6) до носа (x = 7,4).
    const fuselageProfile: [number, number][] = [
        [-8.6, 0.05],
        [-8.4, 0.32],
        [-7.6, 0.48],
        [-5.5, 0.66],
        [-2.5, 0.82],
        [0.5, 0.9],
        [3.0, 0.9],
        [5.0, 0.84],
        [6.0, 0.74],
        [6.6, 0.6],
    ];
    const fuselageZ = -0.1;

    mesh(paint(add(bodyOfRevolution(fuselageProfile, 24)), (z) => z + fuselageZ, 0.12), painted, 0, 0, fuselageZ);

    // Остеклённый нос бомбардира с переплётом и курсовым пулемётом.
    const noseGlass = add(bodyOfRevolution([[6.55, 0.6], [6.9, 0.55], [7.25, 0.4], [7.45, 0.18], [7.52, 0.01]], 16));

    mesh(noseGlass, glass, 0, 0, fuselageZ);

    for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        const rib = mesh(add(new THREE.TorusGeometry(0.42, 0.02, 4, 12, Math.PI)), frame, 7.05, 0, fuselageZ);

        rib.rotation.set(angle, Math.PI / 2, 0);
    }

    const noseGun = mesh(add(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 6)), dark, 7.6, 0.1, fuselageZ + 0.15);

    noseGun.rotation.z = Math.PI / 2;

    // Фонарь кабины пилотов со стойками.
    const canopy = mesh(add(new THREE.SphereGeometry(0.75, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2)), glass, 4.5, 0, -0.78);

    canopy.scale.set(2.0, 1.0, 0.75);
    canopy.rotation.x = Math.PI;

    for (const x of [3.6, 4.5, 5.3]) {
        const arch = mesh(add(new THREE.TorusGeometry(0.72, 0.03, 4, 16, Math.PI)), frame, x, 0, -0.78);

        arch.rotation.y = Math.PI / 2;
        arch.rotation.x = Math.PI;
        arch.scale.set(1, 1, 0.75);
    }

    // Верхняя турель за кабиной, хвостовая точка стрелка, бортовые окна.
    const turret = mesh(add(new THREE.SphereGeometry(0.55, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2)), glass, 1.9, 0, -0.9);

    turret.rotation.x = Math.PI;

    for (const side of [-0.12, 0.12]) {
        const barrel = mesh(add(new THREE.CylinderGeometry(0.025, 0.025, 1.1, 6)), dark, 2.4, side, -1.15);

        barrel.rotation.z = Math.PI / 2;
    }

    mesh(add(bodyOfRevolution([[-8.75, 0.01], [-8.6, 0.28], [-8.1, 0.36], [-7.6, 0.38]], 14)), glass, 0, 0, -0.05);

    for (const side of [-1, 1]) {
        const window = mesh(add(new THREE.PlaneGeometry(0.9, 0.55)), frame, -3.2, side * 0.8, -0.2);

        window.rotation.x = Math.PI / 2;
        window.rotation.y = side > 0 ? 0 : Math.PI;
    }

    // ── Крыло «чайка»: центроплан с поперечным V до мотогондол, консоли с небольшим обратным V.
    const wingZ = 0.22;

    for (const side of [-1, 1]) {
        const inner = add(panel(4.2, 3.6, 2.97, 0.42));

        if (side < 0) {
            inner.scale(1, -1, 1);
        }

        const innerMesh = mesh(paint(inner, (z) => z + wingZ, 0.0), painted, 0.6, 0, wingZ, false);

        innerMesh.rotation.x = side * -0.07;

        const outer = add(panel(3.6, 1.4, 7.33, 0.3, -0.25));

        if (side < 0) {
            outer.scale(1, -1, 1);
        }

        const outerMesh = mesh(paint(outer, (z) => z + wingZ, 0.0), painted, 0.6, side * 2.97, wingZ - 0.2, false);

        outerMesh.rotation.x = side * 0.03;
    }

    // ── Оперение: стабилизатор с небольшим поперечным V, два овальных киля на концах.
    for (const side of [-1, 1]) {
        const stab = add(panel(1.9, 1.2, 3.35, 0.16));

        if (side < 0) {
            stab.scale(1, -1, 1);
        }

        mesh(paint(stab, (z) => z - 0.35, 0.0), painted, -7.7, 0, -0.35, false).rotation.x = side * -0.08;

        const fin = mesh(add(new THREE.SphereGeometry(1, 16, 12)), olive, -7.9, side * 3.35, -0.95, false);

        fin.scale.set(0.95, 0.09, 1.25);

        const rudderLine = mesh(add(new THREE.BoxGeometry(0.03, 0.2, 2.2)), frame, -8.45, side * 3.35, -0.95, false);

        rudderLine.rotation.y = 0.05;
    }

    // ── Мотогондолы (капот, кок винта, патрубки), винты, шасси.
    const propellers: THREE.Object3D[] = [];
    const bladeGeometry = add(new THREE.BoxGeometry(0.1, 1.9, 0.26));

    bladeGeometry.translate(0, 0.95, 0);

    for (const side of [-1, 1]) {
        const y = side * 2.97;
        const nacelle = add(bodyOfRevolution([[-3.6, 0.05], [-2.6, 0.45], [-0.5, 0.66], [1.6, 0.74], [2.6, 0.72], [3.1, 0.62]], 18));

        // Мотогондолы видны и из кабины.
        mesh(paint(nacelle, (z) => z + 0.18, 0.25), painted, 0.8, y, 0.18, false);

        const cowl = mesh(add(new THREE.CylinderGeometry(0.62, 0.72, 0.5, 20, 1, true)), frame, 3.55, y, 0.18, false);

        cowl.rotation.z = Math.PI / 2;

        for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            const stack = mesh(add(new THREE.CylinderGeometry(0.05, 0.05, 0.25, 6)), exhaust, 3.05, y + Math.sin(a) * 0.7, 0.18 + Math.cos(a) * 0.7, false);

            stack.rotation.z = Math.PI / 2;
        }

        const hub = new THREE.Group();
        const spinner = new THREE.Mesh(add(new THREE.ConeGeometry(0.22, 0.45, 12)), dark);

        spinner.rotation.z = -Math.PI / 2;
        spinner.position.x = 0.15;
        hub.add(spinner);
        hub.position.set(3.85, y, 0.18);

        for (let i = 0; i < 3; i++) {
            const blade = new THREE.Mesh(bladeGeometry, dark);

            blade.rotation.x = (i * Math.PI * 2) / 3;
            hub.add(blade);
        }

        root.add(hub);
        propellers.push(hub);
    }

    const gear: THREE.Object3D[] = [];
    const wheelGeometry = add(new THREE.CylinderGeometry(0.55, 0.55, 0.32, 18));
    const noseWheelGeometry = add(new THREE.CylinderGeometry(0.38, 0.38, 0.22, 16));
    const strutGeometry = add(new THREE.CylinderGeometry(0.08, 0.08, 1.6, 8));

    for (const [x, y, nose] of [
        [4.5, 0, true],
        [-0.45, -2.97, false],
        [-0.45, 2.97, false],
    ] as const) {
        const leg = new THREE.Group();
        const strut = new THREE.Mesh(strutGeometry, dark);
        const wheel = new THREE.Mesh(nose ? noseWheelGeometry : wheelGeometry, dark);

        strut.rotation.x = Math.PI / 2;
        strut.position.z = 0.8;
        wheel.position.z = nose ? 1.7 : 1.55;
        leg.add(strut, wheel);
        leg.position.set(x, y, 0.1);
        root.add(leg);
        gear.push(leg);
    }

    // ── Опознавательные знаки: на бортах фюзеляжа и на крыле (левый верх, правый низ).
    const insignia = insigniaTexture();

    textures.push(insignia);

    const insigniaMat = mat(new THREE.MeshStandardMaterial({ map: insignia, transparent: true, roughness: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));

    for (const side of [-1, 1]) {
        const decal = mesh(add(new THREE.PlaneGeometry(2.2, 1.1)), insigniaMat, -4.4, side * 0.75, -0.08);

        decal.setRotationFromMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(side, 0, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, side, 0)));
    }

    const wingTop = mesh(add(new THREE.PlaneGeometry(2.4, 1.2)), insigniaMat, 0.2, -7.6, -0.05, false);

    wingTop.setRotationFromMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1)));

    const wingBottom = mesh(add(new THREE.PlaneGeometry(2.4, 1.2)), insigniaMat, 0.2, 7.6, 0.33, false);

    wingBottom.setRotationFromMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, -1, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1)));

    // ── Надпись и код (из конфигурации борта); слот под рисунок заказчика (раздел 3, «Ливрея и права»).
    const plateTexture = nameplateTexture(markings);

    textures.push(plateTexture);

    const plate = mat(new THREE.MeshStandardMaterial({ map: plateTexture, transparent: true, roughness: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    const nameplate = mesh(add(new THREE.PlaneGeometry(2.4, 0.6)), plate, 5.0, -0.86, -0.2);

    // Левый борт: нормаль −y, «вверх» текста −z, читается от носа к хвосту.
    nameplate.setRotationFromMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, -1, 0)));

    const noseArtMaterial = mat(new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0, roughness: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    const noseArtSlot = mesh(add(new THREE.PlaneGeometry(1.2, 1.0)), noseArtMaterial, 5.5, 0.84, 0.0);

    noseArtSlot.name = 'nose_art';
    noseArtSlot.setRotationFromMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0)));

    let noseArtTexture: THREE.Texture | null = null;

    return {
        root,
        propellers,
        gear,
        exteriorOnly,
        noseArtSlot,
        setNoseArt: (url) => {
            noseArtTexture?.dispose();
            noseArtTexture = null;
            noseArtMaterial.map = null;
            noseArtMaterial.opacity = 0;
            noseArtMaterial.needsUpdate = true;

            if (url !== null) {
                new THREE.TextureLoader().load(url, (texture) => {
                    texture.colorSpace = THREE.SRGBColorSpace;
                    noseArtTexture = texture;
                    noseArtMaterial.map = texture;
                    noseArtMaterial.opacity = 1;
                    noseArtMaterial.needsUpdate = true;
                });
            }
        },
        dispose: () => {
            noseArtTexture?.dispose();
            textures.forEach((t) => t.dispose());
            geometries.forEach((g) => g.dispose());
            materials.forEach((m) => m.dispose());
        },
    };
}
