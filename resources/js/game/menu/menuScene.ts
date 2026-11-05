import * as THREE from 'three';
import { attitudeFromEuler } from '@/sim/core/math';
import type { TheatreConfig } from '@/sim/core/terrain';
import { ProceduralTerrain } from '@/sim/core/terrain';
import { createAircraftModel } from '../render/aircraftModel';
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
};

export type MenuScene = { dispose(): void };

type Flight = {
    kind: 'takeoff' | 'landing';
    model: AircraftModel;
    /** Положение вдоль полосы (y, м), высота над полосой, скорость. */
    along: number;
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
    const eye = at(threshold + 10, -40, 1.9);
    const look = at(threshold + 480, 4, 14);

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

    // Стоянка слева от полосы: самолёты эскадрильи, вышка и палатки.
    const props: { dispose(): void }[] = [];
    const parked: AircraftModel[] = [];

    for (const [along, across, yaw] of [
        [threshold + 560, -95, 0.9],
        [threshold + 620, -108, 1.05],
        [threshold + 690, -100, 0.8],
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

        tent.position.copy(toThree(at(threshold + 780 + i * 14, -150 - (i % 2) * 10, 2.2)));
        tent.rotation.y = Math.PI / 4;
        world.scene.add(tent);
    }

    const tower = new THREE.Mesh(towerGeometry, towerMaterial);
    const cabin = new THREE.Mesh(cabinGeometry, towerMaterial);

    tower.position.copy(toThree(at(threshold + 880, -120, 4.5)));
    cabin.position.copy(toThree(at(threshold + 880, -120, 10.5)));
    world.scene.add(tower, cabin);

    const flights: Flight[] = [];
    let nextEventS = 1.5 + random() * 3;

    const startFlight = (): void => {
        const takeoff = random() < 0.5;
        const damaged = !takeoff && random() < damagedChance;
        const model = createAircraftModel();

        world.scene.add(model.root);
        flights.push({
            kind: takeoff ? 'takeoff' : 'landing',
            model,
            along: takeoff ? threshold + 75 : threshold - 2600,
            height: takeoff ? 0 : (2600 + 320) * Math.tan(GLIDE),
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

        if (f.kind === 'takeoff') {
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
        } else {
            const touchdown = threshold + 320;
            const toTouchdown = touchdown - f.along;

            if (f.height > 0.05) {
                // Глиссада 3°, выравнивание у земли.
                const glide = Math.max(toTouchdown, 0) * Math.tan(GLIDE);
                const flare = f.height < 9;
                const sink = flare ? Math.max(0.5, f.height * 0.18) : f.speed * Math.tan(GLIDE) + 0.3 * (f.height - glide);

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
                f.speed = Math.max(0, f.speed - (f.belly ? 6.5 : 3.2) * dt);

                if (f.speed < 0.5) {
                    f.stoppedS += dt;
                }
            }

            f.along += f.speed * dt;
            f.done = f.stoppedS > (f.belly ? 10 : 4) || f.along > runway.length_m / 2 + 400;
        }

        const p = at(f.along, 0, f.height + (f.belly && f.height <= 0.05 ? 1.15 : 2.0 * (f.gear > 0.5 ? 1 : 0.55)));

        attitudeToThree(attitudeFromEuler(h, f.pitch, f.roll), quat);
        f.model.root.quaternion.copy(quat);
        f.model.root.position.copy(toThree(p, tmp));

        f.model.propellers.forEach((prop, i) => {
            const dead = f.damaged && i === f.deadEngine;

            prop.rotation.x += dead ? 0 : dt * 40;
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
        const busy = flights.some((f) => f.onRunway || (f.kind === 'landing' && f.height > 0.05));

        if (!busy) {
            nextEventS -= dt;

            if (nextEventS <= 0) {
                startFlight();
                nextEventS = minGap + random() * (maxGap - minGap);
            }
        }

        for (const f of flights) {
            updateFlight(f, dt);
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
