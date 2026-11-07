import * as THREE from 'three';
import { attitudeFromEuler } from '@/sim/core/math';
import type { TheatreConfig } from '@/sim/core/terrain';
import { ProceduralTerrain } from '@/sim/core/terrain';
import { createAircraftModel } from '../render/aircraftModel';
import type { Placer } from './airfieldProps';
import { buildAirfield } from './airfieldProps';
import type { RawPoint, TaxiPath, TaxiPoint } from './paths';
import { angleDelta, arc, finishPath, line, pointAt } from './paths';
import { buildRoads, createTraffic } from './roads';
import type { AircraftModel } from '../render/aircraftModel';
import { attitudeToThree, toThree } from '../render/coords';
import { createWorld } from '../render/world';

/**
 * Фон главного меню: вид с левой стороны начала полосы Алезани. По полосе через случайные
 * промежутки взлетают и садятся B-25J; часть садящихся — подбитые (дым, остановленный винт,
 * покачивание, иногда посадка на фюзеляж). Чисто декоративная кинематика, не симядро.
 */
export type MenuSceneOptions = {
    /** Пауза между событиями, с. */
    intervalS?: [number, number];
    /** Доля посадок подбитых самолётов. */
    damagedChance?: number;
    /** Доля посадок на фюзеляж среди подбитых. */
    bellyChance?: number;
    random?: () => number;
    /** Только взлёты, посадки, пролёты строем или машины (отладка сцены, `?debug_menu=` вне продакшена). */
    only?: 'takeoff' | 'landing' | 'formation' | 'traffic';
};

export type MenuScene = { dispose(): void };
export type { TaxiPath, TaxiPoint };
export { pointAt };

type Flight = {
    kind: 'takeoff' | 'landing';
    model: AircraftModel;
    /** Положение вдоль полосы (м от центра), поперёк (вправо), высота над полосой, скорость. */
    along: number;
    across: number;
    /** Курс относительно полосы (рад, вправо — плюс): при рулении самолёт поворачивает. */
    yaw: number;
    /** Взлёт: руление со стоянки → исполнительный старт (пауза) → разбег. Посадка: пробег → сход с полосы (exit). */
    phase: 'taxi' | 'hold' | 'roll' | 'exit';
    /** Пройдено по пути руления, м; время на исполнительном старте, с. */
    taxiS: number;
    holdS: number;
    height: number;
    speed: number;
    pitch: number;
    roll: number;
    gear: number;
    t: number;
    damaged: boolean;
    belly: boolean;
    /** Остановленный винт подбитого (0 — левый, 1 — правый). */
    deadEngine: 0 | 1;
    stoppedS: number;
    onRunway: boolean;
    done: boolean;
    smokeTimer: number;
};

type Puff = { mesh: THREE.Mesh; age: number; life: number; grow: number; rise: number };

const GLIDE = (3 * Math.PI) / 180;
/** Руление: прямо и в развороте (м/с), разгон и торможение (м/с²), пауза на исполнительном старте (с). */
const TAXI_SPEED = 10;
const TAXI_TURN_SPEED = 5;
const TAXI_ACCEL = 1.2;
const TAXI_BRAKE = 1.6;
const HOLD_S = 3;
/**
 * Посадка: точка прицеливания глиссады в 220 м от торца; с выравниванием касание выходит около 430 м.
 * Торможение на пробеге (м/с²) — к сходу в 1100 м на скорости разворота.
 */
const TOUCHDOWN_M = 220;
const ROLLOUT_BRAKE = 3.2;
const EXIT_M = 1100;

/**
 * Взлёт: со стоянки (за левым краем кадра) по параллельной рулёжке → направо на соединительную →
 * налево на ось полосы (исполнительный старт).
 */
export function buildTaxiPath(lineup: number, radius: number, standAlong: number, side: number): TaxiPath {
    const raw: RawPoint[] = [];
    const connector = lineup - radius;

    line(raw, standAlong, side, connector - radius, side);
    arc(raw, connector - radius, side + radius, radius, -Math.PI / 2, 0);
    line(raw, connector, side + radius, connector, -radius);
    arc(raw, connector + radius, -radius, radius, Math.PI, Math.PI / 2);

    return finishPath(raw);
}

/**
 * Посадка: с оси полосы в конце пробега налево на рулёжку схода → налево на параллельную рулёжку → по ней
 * обратно к торцу, мимо стоянки взлетающих, за левый край кадра.
 */
export function buildExitPath(exitAlong: number, radius: number, side: number, endAlong: number): TaxiPath {
    const raw: RawPoint[] = [{ along: exitAlong, across: 0, yaw: 0, turn: false }];

    arc(raw, exitAlong, -radius, radius, Math.PI / 2, 0);
    line(raw, exitAlong + radius, -radius, exitAlong + radius, side + radius);
    arc(raw, exitAlong, side + radius, radius, 0, -Math.PI / 2);
    line(raw, exitAlong, side, endAlong, side);

    return finishPath(raw);
}

export type FormationKind = 'vic' | 'echelon' | 'box';
export type FormationSlot = { back: number; right: number; up: number };

/** Места в строю относительно ведущего: клин из 3, уступ вправо из 4, «коробка» из двух клиньев. */
export function formationSlots(kind: FormationKind): FormationSlot[] {
    const vic: FormationSlot[] = [
        { back: 0, right: 0, up: 0 },
        { back: 22, right: -28, up: -2 },
        { back: 22, right: 28, up: -2 },
    ];

    if (kind === 'vic') {
        return vic;
    }

    if (kind === 'echelon') {
        return [0, 1, 2, 3].map((i) => ({ back: i * 18, right: i * 24, up: i === 0 ? 0 : -i * 1.5 }));
    }

    return [...vic, ...vic.map((v) => ({ back: v.back + 70, right: v.right + 15, up: v.up - 12 }))];
}

/**
 * Трасса пролёта строем в осях полосы: курс `course` (рад от оси полосы, вправо — плюс) с любой стороны, линия пути
 * проходит мимо точки камеры на `offset` м (плюс — правее по ходу). Старт — за `approach` м до траверза камеры.
 */
export function formationTrack(
    course: number,
    offset: number,
    camera: { along: number; across: number },
    approach: number,
): { startAlong: number; startAcross: number; dirAlong: number; dirAcross: number; rightAlong: number; rightAcross: number } {
    const dirAlong = Math.cos(course);
    const dirAcross = Math.sin(course);
    // Вправо по ходу — курс + 90°.
    const rightAlong = -Math.sin(course);
    const rightAcross = Math.cos(course);

    return {
        startAlong: camera.along - dirAlong * approach + rightAlong * offset,
        startAcross: camera.across - dirAcross * approach + rightAcross * offset,
        dirAlong,
        dirAcross,
        rightAlong,
        rightAcross,
    };
}

const CLIMB = (7 * Math.PI) / 180;
const MAX_PUFFS = 140;

export function mountMenuScene(container: HTMLElement, theatre: TheatreConfig, options: MenuSceneOptions = {}): MenuScene {
    const random = options.random ?? Math.random;
    const [minGap, maxGap] = options.intervalS ?? [5, 18];
    const damagedChance = options.damagedChance ?? 0.3;
    const bellyChance = options.bellyChance ?? 0.35;
    const runway = theatre.runways[0];

    if (runway === undefined) {
        throw new Error('Theatre has no runway');
    }

    const terrain = new ProceduralTerrain(theatre);
    const world = createWorld(terrain, theatre.runways, 'low');
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' });

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.domElement.style.display = 'block';
    container.appendChild(renderer.domElement);

    // Утреннее солнце пониже — длинный тёплый свет.
    world.sun.position.set(-6000, 3000, -2000);
    world.sun.color.set(0xffe2b8);

    const camera = new THREE.PerspectiveCamera(36, 1, 0.5, 60000);
    const h = runway.heading;
    const fwd = { x: Math.sin(h), y: Math.cos(h) };
    const right = { x: Math.cos(h), y: -Math.sin(h) };
    const threshold = -runway.length_m / 2;
    const ground = runway.elevation_m;

    /** Точка в осях полосы: along — вдоль курса от центра, across — вправо. */
    const at = (along: number, across: number, height: number): { x: number; y: number; z: number } => ({
        x: runway.x + fwd.x * along + right.x * across,
        y: runway.y + fwd.y * along + right.y * across,
        z: ground + height,
    });

    // Камера: слева от торца, у земли, смотрит вдоль полосы.
    // Камера поднята на 7 м (как с кузова грузовика у полосы) и чуть смотрит вниз: видны рулёжки и стоянка.
    const eye = at(threshold + 10, -40, 7);
    const look = at(threshold + 480, 4, 4);

    camera.position.copy(toThree(eye));
    camera.lookAt(toThree(look));

    const baseQuat = camera.quaternion.clone();

    const resize = (): void => {
        const width = container.clientWidth || window.innerWidth;
        const height = container.clientHeight || window.innerHeight;

        renderer.setSize(width, height, false);
        renderer.domElement.style.width = `${width}px`;
        renderer.domElement.style.height = `${height}px`;
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);

    observer.observe(container);
    resize();

    // Дым подбитых двигателей.
    const puffGeometry = new THREE.IcosahedronGeometry(1, 1);
    const puffMaterial = new THREE.MeshBasicMaterial({ color: 0x2b2b2b, transparent: true, opacity: 0.55, depthWrite: false });
    const sparkMaterial = new THREE.MeshBasicMaterial({ color: 0xffb04a, transparent: true, opacity: 0.9, depthWrite: false });
    const puffs: Puff[] = [];

    const spawnPuff = (position: THREE.Vector3, spark = false): void => {
        let puff = puffs.find((p) => p.age >= p.life);

        if (puff === undefined) {
            if (puffs.length >= MAX_PUFFS) {
                return;
            }

            puff = { mesh: new THREE.Mesh(puffGeometry, puffMaterial), age: 0, life: 0, grow: 0, rise: 0 };
            world.scene.add(puff.mesh);
            puffs.push(puff);
        }

        puff.mesh.material = spark ? sparkMaterial : puffMaterial;
        puff.mesh.position.copy(position);
        puff.mesh.visible = true;
        puff.age = 0;
        puff.life = spark ? 0.4 + random() * 0.3 : 3 + random() * 2;
        puff.grow = spark ? 0.4 : 1.6 + random();
        puff.rise = spark ? 0.5 : 1.5;
    };

    // Стоянка слева от полосы, ближе к камере (290–470 м от торца), но за соединительной рулёжкой (230 м):
    // самолёты эскадрильи, палатки и вышка руления не загораживают.
    const props: { dispose(): void }[] = [];
    const parked: AircraftModel[] = [];

    for (const [along, across, yaw] of [
        [threshold + 290, -82, 0.9],
        [threshold + 340, -95, 1.05],
        [threshold + 395, -86, 0.8],
    ] as const) {
        const m = createAircraftModel();

        attitudeToThree(attitudeFromEuler(h + yaw, 0.02, 0), m.root.quaternion);
        m.root.position.copy(toThree(at(along, across, 2.0)));
        world.scene.add(m.root);
        parked.push(m);
    }

    const tentMaterial = new THREE.MeshLambertMaterial({ color: 0x6b6a4a });
    const towerMaterial = new THREE.MeshLambertMaterial({ color: 0x8b7d62 });
    const tentGeometry = new THREE.ConeGeometry(4, 4.5, 4);
    const towerGeometry = new THREE.BoxGeometry(5, 9, 5);
    const cabinGeometry = new THREE.BoxGeometry(6.5, 3, 6.5);

    props.push(tentMaterial, towerMaterial, tentGeometry, towerGeometry, cabinGeometry);

    for (let i = 0; i < 6; i++) {
        const tent = new THREE.Mesh(tentGeometry, tentMaterial);

        tent.position.copy(toThree(at(threshold + 440 + i * 14, -120 - (i % 2) * 8, 2.2)));
        tent.rotation.y = Math.PI / 4;
        world.scene.add(tent);
    }

    const tower = new THREE.Mesh(towerGeometry, towerMaterial);
    const cabin = new THREE.Mesh(cabinGeometry, towerMaterial);

    tower.position.copy(toThree(at(threshold + 470, -110, 4.5)));
    cabin.position.copy(toThree(at(threshold + 470, -110, 10.5)));
    world.scene.add(tower, cabin);

    // Постройки аэродрома, сервисные дороги и машины: along — от торца, объект стоит на рельефе.
    const place: Placer = (obj, along, across, yaw = 0) => {
        const enu = at(threshold + along, across, 0);

        toThree(enu, obj.position);
        obj.position.y = terrain.heightAt(enu.x, enu.y);
        obj.rotation.set(0, -(h + yaw), 0);
    };

    props.push(buildAirfield(world.scene, place, runway.length_m), buildRoads(world.scene, place));

    const traffic = createTraffic(world.scene, place, random, { gapS: options.only === 'traffic' ? [1, 3] : [6, 18] });
    const trafficOn = options.only === undefined || options.only === 'traffic';

    // Стоянка — слева за краем кадра (камера у торца смотрит вдоль полосы): самолёт въезжает в кадр по рулёжке,
    // а не появляется на виду. Исполнительный старт — в 260 м от торца, развороты видны сбоку.
    const lineup = threshold + 260;
    const taxiPath = buildTaxiPath(lineup, 30, threshold + 110, -150);

    // Сход с полосы — в 1100 м от торца (после пробега скорость уже рулёжная), рулёжка — та же параллельная;
    // садящийся уезжает по ней за край кадра, мимо стоянки взлетающих.
    const side = -150;
    const exitAlong = threshold + EXIT_M;
    const exitPath = buildExitPath(exitAlong, 35, side, threshold + 30);

    // Рулёжки: асфальт и жёлтая осевая. Чуть ниже полосы (+0,04 м против +0,05) — на стыке полоса сверху,
    // осевая выше полосы — вводная линия на полосу, как на настоящем аэродроме.
    const asphalt = new THREE.MeshLambertMaterial({ color: 0x45443f, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
    const centreline = new THREE.MeshBasicMaterial({ color: 0xc9a33a, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -6 });

    props.push(asphalt, centreline);

    const ribbon = (path: TaxiPath, width: number, lift: number, material: THREE.Material): void => {
        const positions: number[] = [];
        const indices: number[] = [];
        const v = new THREE.Vector3();

        path.points.forEach((pt, i) => {
            // Перпендикуляр к курсу в осях полосы: (−sin, cos).
            const na = -Math.sin(pt.yaw) * (width / 2);
            const nc = Math.cos(pt.yaw) * (width / 2);

            for (const sign of [-1, 1]) {
                toThree(at(pt.along + sign * na, pt.across + sign * nc, lift), v);
                positions.push(v.x, v.y, v.z);
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
        props.push(geometry);
        world.scene.add(new THREE.Mesh(geometry, material));
    };

    for (const path of [taxiPath, exitPath]) {
        ribbon(path, 15, 0.04, asphalt);
        ribbon(path, 0.4, 0.06, centreline);
    }

    /**
     * Руление по пути: на прямой — до TAXI_SPEED, к развороту и к концу пути тормозить заранее
     * (v² = v_разв² + 2·a·d), разгон и торможение — с ограничением ускорения; курс догоняет касательную плавно
     * (передняя стойка не поворачивает мгновенно), нос чуть клюёт при торможении. Возвращает true в конце пути.
     */
    const followPath = (f: Flight, path: TaxiPath, dt: number): boolean => {
        const here = pointAt(path, f.taxiS);
        const toTurn = Math.max(0, here.nextTurnS - f.taxiS);
        const left = Math.max(0, path.length - f.taxiS);
        const target = Math.min(
            here.turn ? TAXI_TURN_SPEED : Math.min(TAXI_SPEED, Math.sqrt(TAXI_TURN_SPEED ** 2 + 2 * TAXI_BRAKE * toTurn)),
            Math.sqrt(2 * TAXI_BRAKE * left) + 0.25,
        );
        const before = f.speed;

        f.speed = f.speed < target ? Math.min(target, f.speed + TAXI_ACCEL * dt) : Math.max(target, f.speed - TAXI_BRAKE * dt);
        f.taxiS = Math.min(path.length, f.taxiS + f.speed * dt);

        const p = pointAt(path, f.taxiS);

        f.along = p.along;
        f.across = p.across;
        f.yaw += angleDelta(p.yaw, f.yaw) * Math.min(1, dt * 6);

        const accel = dt > 0 ? (f.speed - before) / dt : 0;

        f.pitch += (Math.max(-0.012, Math.min(0.008, accel * 0.004)) - f.pitch) * Math.min(1, dt * 4);

        return f.taxiS >= path.length - 0.05;
    };

    const flights: Flight[] = [];
    let nextEventS = 1.5 + random() * 3;

    // Пролёты строем на малой высоте: со стороны дальнего конца полосы прямо на камеру и над ней.
    type Formation = {
        planes: { model: AircraftModel; slot: FormationSlot; phase: number }[];
        track: ReturnType<typeof formationTrack>;
        course: number;
        /** Пройдено ведущим от старта, м. */
        travelled: number;
        height: number;
        speed: number;
        t: number;
        maxBack: number;
    };
    const formations: Formation[] = [];
    // Точка, мимо которой проходит строй, — камера (у торца, слева от полосы).
    const FORMATION_CAMERA = { along: threshold + 10, across: -40 };
    const FORMATION_APPROACH_M = 6500;
    const runwayTraffic = options.only === undefined || options.only === 'takeoff' || options.only === 'landing';
    const formationsOn = options.only === undefined || options.only === 'formation';
    const formationGap: [number, number] = options.only === 'formation' ? [4, 8] : [45, 90];
    let nextFormationS = options.only === 'formation' ? 1 : 12 + random() * 10;

    /**
     * Курс пролёта — любой, линия пути над камерой или рядом (до ±80 м), старт за 6,5 км. Рельеф вдоль трассы не выше
     * 60 м над аэродромом (на западе — горы Корсики): иначе другой курс; не нашёлся — вдоль полосы с дальнего конца.
     */
    const pickFormationCourse = (): { course: number; track: ReturnType<typeof formationTrack>; travelled: number } => {
        const clear = (track: ReturnType<typeof formationTrack>): boolean => {
            for (let d = 0; d <= FORMATION_APPROACH_M + 3000; d += 200) {
                const p = at(track.startAlong + track.dirAlong * d, track.startAcross + track.dirAcross * d, 0);

                if (terrain.heightAt(p.x, p.y) - ground > 60) {
                    return false;
                }
            }

            return true;
        };

        for (let attempt = 0; attempt < 12; attempt++) {
            const course = random() * Math.PI * 2;
            const track = formationTrack(course, (random() - 0.5) * 160, FORMATION_CAMERA, FORMATION_APPROACH_M);

            if (clear(track)) {
                return { course, track, travelled: 0 };
            }
        }

        return { course: Math.PI, track: formationTrack(Math.PI, 0, FORMATION_CAMERA, FORMATION_APPROACH_M), travelled: 0 };
    };

    const startFormation = (): void => {
        const kinds: FormationKind[] = ['vic', 'echelon', 'box'];
        const kind = kinds[Math.min(kinds.length - 1, Math.floor(random() * kinds.length))]!;
        const slots = formationSlots(kind);

        formations.push({
            planes: slots.map((slot) => {
                const model = createAircraftModel();

                // Шасси убраны.
                for (const leg of model.gear) {
                    leg.visible = false;
                }

                world.scene.add(model.root);

                return { model, slot, phase: random() * Math.PI * 2 };
            }),
            ...pickFormationCourse(),
            height: 160 + random() * 90,
            speed: 72 + random() * 8,
            t: 0,
            maxBack: Math.max(...slots.map((v) => v.back)),
        });
    };

    const updateFormation = (fm: Formation, dt: number): boolean => {
        fm.t += dt;
        fm.travelled += fm.speed * dt;

        const tr = fm.track;

        for (const pl of fm.planes) {
            // Место в строю: «назад» — против хода, «вправо» — вправо по ходу; лёгкое покачивание.
            const bob = Math.sin(fm.t * 0.6 + pl.phase) * 1.2;
            const sway = Math.sin(fm.t * 0.4 + pl.phase) * 1.5;
            const forward = fm.travelled - pl.slot.back;
            const right = pl.slot.right + sway;
            const p = at(
                tr.startAlong + tr.dirAlong * forward + tr.rightAlong * right,
                tr.startAcross + tr.dirAcross * forward + tr.rightAcross * right,
                fm.height + pl.slot.up + bob,
            );

            attitudeToThree(attitudeFromEuler(h + fm.course, 0.01 * Math.sin(fm.t * 0.5 + pl.phase), Math.sin(fm.t * 0.5 + pl.phase) * 0.04), quat);
            pl.model.root.quaternion.copy(quat);
            pl.model.root.position.copy(toThree(p, tmp));
            pl.model.propellers.forEach((prop) => {
                prop.rotation.x += dt * 45;
            });
        }

        // Весь строй прошёл камеру и ушёл на 3 км — убрать.
        return fm.travelled - fm.maxBack > FORMATION_APPROACH_M + 3000;
    };

    const startFlight = (): void => {
        const takeoff = options.only ? options.only === 'takeoff' : random() < 0.5;
        const damaged = !takeoff && random() < damagedChance;
        const model = createAircraftModel();

        world.scene.add(model.root);
        flights.push({
            kind: takeoff ? 'takeoff' : 'landing',
            model,
            along: takeoff ? (taxiPath.points[0]?.along ?? lineup) : threshold - 2600,
            across: takeoff ? (taxiPath.points[0]?.across ?? 0) : 0,
            yaw: 0,
            phase: takeoff ? 'taxi' : 'roll',
            taxiS: 0,
            holdS: 0,
            height: takeoff ? 0 : (2600 + TOUCHDOWN_M) * Math.tan(GLIDE),
            speed: takeoff ? 0 : damaged ? 64 : 60,
            pitch: 0,
            roll: 0,
            gear: takeoff ? 1 : 1,
            t: 0,
            damaged,
            belly: damaged && random() < bellyChance,
            deadEngine: random() < 0.5 ? 0 : 1,
            stoppedS: 0,
            onRunway: takeoff,
            done: false,
            smokeTimer: 0,
        });
    };

    const engineWorld = (f: Flight, i: 0 | 1, q: THREE.Quaternion, out: THREE.Vector3): THREE.Vector3 =>
        out.set(0.6, i === 0 ? -2.97 : 2.97, -0.2).applyQuaternion(q).add(f.model.root.position);

    const tmp = new THREE.Vector3();
    const quat = new THREE.Quaternion();

    const updateFlight = (f: Flight, dt: number): void => {
        f.t += dt;

        if (f.kind === 'takeoff' && f.phase === 'taxi') {
            if (followPath(f, taxiPath, dt)) {
                f.phase = 'hold';
                f.speed = 0;
                f.along = lineup;
                f.across = 0;
            }
        } else if (f.kind === 'takeoff' && f.phase === 'hold') {
            // Исполнительный старт: стоит на оси, двигатели на взлётный режим; курс и нос дотягиваются до нуля.
            f.holdS += dt;
            f.yaw += angleDelta(0, f.yaw) * Math.min(1, dt * 4);
            f.pitch *= Math.max(0, 1 - dt * 4);

            if (f.holdS >= HOLD_S) {
                f.phase = 'roll';
            }
        } else if (f.kind === 'takeoff') {
            // Разбег → отрыв на 52 м/с → набор 7°, шасси убирается через 3 с.
            if (f.height <= 0 && f.speed < 52) {
                f.speed += 2.6 * dt;
                f.pitch = 0;
            } else {
                f.onRunway = false;
                f.pitch = Math.min(f.pitch + 0.08 * dt, CLIMB + 0.03);
                f.speed = Math.min(f.speed + 1.2 * dt, 70);
                f.height += Math.sin(Math.min(f.pitch, CLIMB)) * f.speed * dt;

                if (f.height > 25) {
                    f.gear = Math.max(0, f.gear - dt / 6);
                }
            }

            f.along += f.speed * dt;
            f.done = f.along > runway.length_m / 2 + 7000;
        } else if (f.phase === 'exit') {
            // После схода полоса свободна; самолёт уезжает по параллельной рулёжке за край кадра.
            f.onRunway = false;
            f.roll *= Math.max(0, 1 - 2 * dt);
            f.done = followPath(f, exitPath, dt);
        } else {
            const touchdown = threshold + TOUCHDOWN_M;
            const toTouchdown = touchdown - f.along;

            if (f.height > 0.05) {
                // Глиссада 3°, выравнивание у земли.
                const glide = Math.max(toTouchdown, 0) * Math.tan(GLIDE);
                const flare = f.height < 9;
                // Выравнивание с 9 м: без «зависания» над полосой (при 0,18·h и 0,5 м/с самолёт пролетал ~660 м
                // и касался уже за сходом).
                const sink = flare ? Math.max(0.9, f.height * 0.3) : f.speed * Math.tan(GLIDE) + 0.3 * (f.height - glide);

                f.height = Math.max(0, f.height - sink * dt);
                f.pitch = flare ? 0.07 : 0.02;
                f.speed = Math.max(f.speed - (flare ? 1.2 : 0.15) * dt, 55);
                f.gear = f.belly ? 0 : Math.min(1, f.gear + dt / 4);

                // Подбитый болтается и держит крен на работающий двигатель.
                if (f.damaged) {
                    f.roll = (f.deadEngine === 0 ? -0.05 : 0.05) + Math.sin(f.t * 1.7) * 0.06 + Math.sin(f.t * 0.6) * 0.04;
                }
            } else {
                // Пробег: на колёсах — тормоза, на фюзеляже — трение и искры.
                f.onRunway = true;
                f.pitch = f.belly ? -0.01 : Math.max(0, f.pitch - 0.05 * dt);
                f.roll = f.belly ? 0.03 * (f.deadEngine === 0 ? -1 : 1) : f.roll * Math.max(0, 1 - 2 * dt);
                if (f.belly) {
                    f.speed = Math.max(0, f.speed - 6.5 * dt);
                } else {
                    // На колёсах — тормозить так, чтобы к сходу с полосы выйти на скорость разворота.
                    const toExit = Math.max(0, exitAlong - f.along);
                    const target = Math.sqrt(TAXI_TURN_SPEED ** 2 + 2 * ROLLOUT_BRAKE * toExit);

                    f.speed = f.speed > target ? Math.max(target, f.speed - (ROLLOUT_BRAKE + 0.5) * dt) : f.speed;
                }

                if (f.speed < 0.5) {
                    f.stoppedS += dt;
                }
            }

            f.along += f.speed * dt;

            // Сход — только на рулёжной скорости; не успел затормозить — докатывается по полосе, как посадка на брюхо.
            if (!f.belly && f.height <= 0.05 && f.along >= exitAlong && f.along < exitAlong + 5 && f.speed <= TAXI_TURN_SPEED + 2) {
                f.phase = 'exit';
                f.along = exitAlong;
                f.taxiS = 0;
            }

            f.done = f.stoppedS > (f.belly ? 10 : 4) || f.along > runway.length_m / 2 + 400;
        }

        const p = at(f.along, f.across, f.height + (f.belly && f.height <= 0.05 ? 1.15 : 2.0 * (f.gear > 0.5 ? 1 : 0.55)));

        attitudeToThree(attitudeFromEuler(h + f.yaw, f.pitch, f.roll), quat);
        f.model.root.quaternion.copy(quat);
        f.model.root.position.copy(toThree(p, tmp));

        f.model.propellers.forEach((prop, i) => {
            const dead = f.damaged && i === f.deadEngine;

            prop.rotation.x += dead ? 0 : dt * (f.phase === 'taxi' || f.phase === 'exit' ? 22 : 40);
        });

        for (const leg of f.model.gear) {
            leg.visible = f.gear > 0.05;
            leg.scale.setScalar(Math.max(f.gear, 0.05));
        }

        // Дым из подбитого двигателя, искры при посадке на брюхо.
        f.smokeTimer -= dt;

        if (f.damaged && f.smokeTimer <= 0) {
            f.smokeTimer = 0.08;
            spawnPuff(engineWorld(f, f.deadEngine, quat, new THREE.Vector3()));
        }

        if (f.belly && f.onRunway && f.speed > 3 && random() < 0.6) {
            spawnPuff(new THREE.Vector3(f.model.root.position.x + (random() - 0.5) * 3, ground + 0.4, f.model.root.position.z + (random() - 0.5) * 6), true);
        }
    };

    let disposed = false;
    let last = performance.now();
    let elapsed = 0;

    const frame = (now: number): void => {
        if (disposed) {
            return;
        }

        requestAnimationFrame(frame);

        const dt = Math.min((now - last) / 1000, 0.1);

        last = now;
        elapsed += dt;

        // Следующий взлёт или посадка — через случайную паузу после освобождения полосы.
        const standAlong = taxiPath.points[0]?.along ?? threshold;
        const busy = flights.some(
            (f) => f.onRunway || (f.kind === 'landing' && f.height > 0.05) || (f.phase === 'exit' && f.along > standAlong - 10),
        );

        if (!busy && runwayTraffic) {
            nextEventS -= dt;

            if (nextEventS <= 0) {
                startFlight();
                nextEventS = minGap + random() * (maxGap - minGap);
            }
        }

        for (const f of flights) {
            updateFlight(f, dt);
        }

        if (trafficOn) {
            traffic.update(dt);
        }

        // Пролёты строем — по одному, через случайную паузу.
        if (formationsOn && formations.length === 0) {
            nextFormationS -= dt;

            if (nextFormationS <= 0) {
                startFormation();
                nextFormationS = formationGap[0] + random() * (formationGap[1] - formationGap[0]);
            }
        }

        for (let i = formations.length - 1; i >= 0; i--) {
            const fm = formations[i]!;

            if (updateFormation(fm, dt)) {
                for (const pl of fm.planes) {
                    world.scene.remove(pl.model.root);
                    pl.model.dispose();
                }

                formations.splice(i, 1);
            }
        }

        for (let i = flights.length - 1; i >= 0; i--) {
            const f = flights[i];

            if (f?.done) {
                world.scene.remove(f.model.root);
                f.model.dispose();
                flights.splice(i, 1);
            }
        }

        for (const puff of puffs) {
            if (puff.age >= puff.life) {
                puff.mesh.visible = false;
                continue;
            }

            puff.age += dt;
            puff.mesh.scale.setScalar(0.8 + puff.age * puff.grow);
            puff.mesh.position.y += puff.rise * dt;
        }

        // Камера «дышит»: лёгкое покачивание, как в руках у наблюдателя.
        camera.quaternion.copy(baseQuat);
        camera.rotateY(Math.sin(elapsed * 0.11) * 0.025);
        camera.rotateX(Math.sin(elapsed * 0.07) * 0.01);

        // Состояние сцены для тестов: сколько и каких полётов сейчас в воздухе и на полосе.
        container.dataset.flights = flights.map((f) => `${f.kind}${f.damaged ? '-damaged' : ''}${f.belly ? '-belly' : ''}`).join(',');
        container.dataset.formations = formations.map((fm) => fm.planes.length).join(',');
        container.dataset.vehicles = String(traffic.count);

        renderer.render(world.scene, camera);
    };

    requestAnimationFrame(frame);

    return {
        dispose: () => {
            disposed = true;
            observer.disconnect();

            for (const f of flights) {
                f.model.dispose();
            }

            formations.forEach((fm) => fm.planes.forEach((pl) => pl.model.dispose()));
            traffic.dispose();
            parked.forEach((m) => m.dispose());
            props.forEach((p) => p.dispose());

            puffGeometry.dispose();
            puffMaterial.dispose();
            sparkMaterial.dispose();
            world.dispose();
            renderer.dispose();
            renderer.domElement.remove();
        },
    };
}
