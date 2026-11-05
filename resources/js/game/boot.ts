import * as Comlink from 'comlink';
import * as THREE from 'three';
import type { AircraftConfig, Debrief, Difficulty, Station, TheatreConfig, WorldAction } from '@/sim/core';
import { mountDirectionBody, parseAircraftConfig, ProceduralTerrain, STATIONS, TICK_HZ } from '@/sim/core';
import type { MissionStatic, WorldView } from '@/sim/view';
import type { SimWorker } from '@/sim/worker';
import simWorkerUrl from '@/sim/worker?worker&url';
import { StationInput } from './input/stationInput';
import { createAircraftModel } from './render/aircraftModel';
import { createCockpit } from './render/cockpit';
import { attitudeToThree, Q_CAMERA_IN_FRD, toThree } from './render/coords';
import { createEntities } from './render/entities';
import { drawPilotPanel } from './render/instruments';
import type { GraphicsPreset } from './render/world';
import { createWorld } from './render/world';

/**
 * Игровой клиент этапа 2: восемь станций, переключение 1–8, ИИ на остальных местах.
 * Монтируется в страницу Inertia, грузится отдельным чанком (раздел 4: code splitting).
 * Мир живёт в воркере; здесь — рендер, камера станции и ввод.
 */
export type CameraView = 'station' | 'external';

export type ScreenMarker = { x: number; y: number; kind: 'lead' | 'fighter'; id: number };

export type GameFrame = {
    view: WorldView;
    statics: MissionStatic;
    fps: number;
    paused: boolean;
    camera: CameraView;
    scope: boolean;
    pointerLocked: boolean;
    timeScale: number;
    markers: ScreenMarker[];
    renderScale: number;
};

export type GameOptions = {
    mode: 'mission' | 'training';
    station: Station;
    config: unknown;
    mission: unknown;
    theatre: TheatreConfig;
    difficulty: Difficulty;
    seed: number;
    graphics?: GraphicsPreset;
    /** Отладочное ускорение сверх ×4 (только не в продакшене): игнорирует ограничения фаз. */
    maxTimeScale?: number;
    onFrame?: (frame: GameFrame) => void;
};

export type GameHandle = {
    act(action: WorldAction): void;
    setStation(station: Station): Promise<void>;
    toggleView(): void;
    toggleScope(): void;
    togglePause(): void;
    setPaused(paused: boolean): void;
    setTimeScale(scale: number): void;
    setDemo(enabled: boolean): Promise<void>;
    setThrottle(value: [number, number]): void;
    restart(): Promise<void>;
    debrief(): Promise<Debrief>;
    dispose(): void;
};

const MAX_STEPS_PER_FRAME = 6;

/**
 * В dev Vite отдаёт воркер с другого origin (:5173), а браузер не создаёт такие воркеры напрямую —
 * оборачиваем в blob с import. В сборке воркер лежит на том же origin.
 */
function createSimWorker(): Worker {
    const url = new URL(simWorkerUrl, window.location.href);

    if (url.origin === window.location.origin) {
        return new Worker(url, { type: 'module' });
    }

    const shim = URL.createObjectURL(new Blob([`import ${JSON.stringify(url.href)};`], { type: 'text/javascript' }));

    return new Worker(shim, { type: 'module' });
}

const COCKPIT_STATIONS: Station[] = ['pilot', 'copilot'];

export async function mountGame(container: HTMLElement, options: GameOptions): Promise<GameHandle> {
    // Пропсы Vue — реактивные Proxy, structured clone в воркер их не принимает.
    const rawConfig: unknown = JSON.parse(JSON.stringify(options.config));
    const rawMission: unknown = JSON.parse(JSON.stringify(options.mission));
    const config: AircraftConfig = parseAircraftConfig(rawConfig);
    const terrain = new ProceduralTerrain(options.theatre);

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    let renderScale = Math.min(window.devicePixelRatio, 1.5);

    renderer.setPixelRatio(renderScale);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';
    renderer.domElement.tabIndex = 0;

    const world = createWorld(terrain, options.theatre.runways, options.graphics ?? 'medium');
    const model = createAircraftModel();
    const cockpit = createCockpit();

    model.root.add(cockpit.group);
    world.scene.add(model.root);

    const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 90000);
    const panelCtx = cockpit.panelCanvas.getContext('2d');
    const canvas = renderer.domElement;
    const input = new StationInput(window, canvas);

    const worker = createSimWorker();
    const sim = Comlink.wrap<SimWorker>(worker);
    let station: Station = options.station;

    const init = async (): Promise<{ view: WorldView; statics: MissionStatic }> =>
        sim.init({ mode: options.mode, config: rawConfig, mission: rawMission, theatre: options.theatre, difficulty: options.difficulty, seed: options.seed, station });

    let { view, statics } = await init();
    let entities = createEntities(world.scene, statics);

    input.setStation(station, view);

    let cameraView: CameraView = 'station';
    let paused = false;
    let pending = false;
    let accumulator = 0;
    let last = performance.now();
    let frame = 0;
    let fps = 60;
    let lowFpsSeconds = 0;
    let disposed = false;
    let timeScale = 1;
    let markers: ScreenMarker[] = [];
    const look = { yaw: 0, pitch: -0.12, fov: 70 };

    const resize = (): void => {
        const width = container.clientWidth || window.innerWidth;
        const height = container.clientHeight || window.innerHeight;

        renderer.setSize(width, height, false);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
    };

    const observer = new ResizeObserver(resize);

    observer.observe(container);
    resize();

    // Осмотр головой: правая кнопка мыши; зум — колесо (раздел 12).
    let looking = false;
    const onMouseDown = (e: MouseEvent): void => {
        if (e.button === 2) {
            looking = true;
        }
    };
    const onMouseUp = (e: MouseEvent): void => {
        if (e.button === 2) {
            looking = false;
        }
    };
    const onMouseMove = (e: MouseEvent): void => {
        if (looking && !input.pointerLocked) {
            look.yaw = THREE.MathUtils.clamp(look.yaw - e.movementX * 0.004, -2.6, 2.6);
            look.pitch = THREE.MathUtils.clamp(look.pitch - e.movementY * 0.004, -1.4, 1.2);
        }
    };
    const onWheel = (e: WheelEvent): void => {
        if (input.wantsPointer() || station === 'radio') {
            return;
        }

        e.preventDefault();
        look.fov = THREE.MathUtils.clamp(look.fov + Math.sign(e.deltaY) * 4, 20, 90);
    };
    const onContextMenu = (e: Event): void => e.preventDefault();
    const onKey = (e: KeyboardEvent): void => {
        if (e.repeat) {
            return;
        }

        const digit = /^Digit([1-8])$/.exec(e.code);

        if (digit) {
            const next = STATIONS[Number(digit[1]) - 1];

            if (next) {
                void handle.setStation(next);
            }
        } else if (e.code === 'KeyV' && options.difficulty === 'training') {
            handle.toggleView();
        } else if (e.code === 'KeyH') {
            look.yaw = 0;
            look.pitch = station === 'navigator' ? -0.5 : -0.12;
            look.fov = 70;
        } else if (e.code === 'KeyP') {
            handle.togglePause();
        }
    };

    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('keydown', onKey);

    const eyes = config.gameplay_station_eyes.value;
    const aircraftQuat = new THREE.Quaternion();
    const lookQuat = new THREE.Quaternion();
    const tmp = new THREE.Vector3();
    const tmp2 = new THREE.Vector3();
    const shake = new THREE.Vector3();

    const placeCamera = (): void => {
        const a = view.aircraft;

        attitudeToThree(a.attitude, aircraftQuat);
        toThree(a.position, model.root.position);
        model.root.quaternion.copy(aircraftQuat);

        const interior = cameraView === 'station' && COCKPIT_STATIONS.includes(station);

        for (const part of model.exteriorOnly) {
            part.visible = !interior;
        }

        cockpit.group.visible = interior;

        if (cameraView === 'external') {
            const behind = new THREE.Vector3(-32, 0, -9).applyQuaternion(aircraftQuat);

            behind.y = Math.max(behind.y, 4);
            camera.position.copy(model.root.position).add(behind);
            camera.up.set(0, 1, 0);
            camera.lookAt(model.root.position);
            camera.fov = 55;
            camera.updateProjectionMatrix();

            return;
        }

        const eye = eyes[station];
        const eyeWorld = tmp.set(eye[0], eye[1], eye[2]).applyQuaternion(aircraftQuat).add(model.root.position);

        // Тряска камеры от близких разрывов и попаданий.
        const hit = view.damage.lastHitAgoS;
        const intensity = hit !== null && hit < 0.4 ? (0.4 - hit) * 0.25 : 0;

        shake.set((Math.random() - 0.5) * intensity, (Math.random() - 0.5) * intensity, (Math.random() - 0.5) * intensity);
        camera.position.copy(eyeWorld).add(shake);

        if (station === 'bombardier' && input.scope && view.sight.on && view.sight.aim) {
            // Окуляр прицела: узкое поле зрения на точку прицеливания, «вверх» — по пути.
            const target = tmp2.set(a.position.x + view.sight.aim.x, statics.target.aim.z, -(a.position.y + view.sight.aim.y));
            const track = view.derived.heading + view.sight.driftRad;

            camera.up.set(Math.sin(track), 0, -Math.cos(track));
            camera.lookAt(target);
            camera.fov = 7;
        } else if (input.gunMode()) {
            // За пулемётом: камера смотрит по желаемому направлению ствола.
            const dirBody = mountDirectionBody(input.aim.az, input.aim.el);
            const dirWorld = tmp2.set(dirBody.x, dirBody.y, dirBody.z).applyQuaternion(aircraftQuat);
            const up = new THREE.Vector3(0, 0, -1).applyQuaternion(aircraftQuat);

            camera.up.copy(up);
            camera.lookAt(dirWorld.add(camera.position));
            camera.fov = look.fov;
        } else {
            const pitch = station === 'navigator' && look.pitch === -0.12 ? -0.5 : look.pitch;

            lookQuat.setFromEuler(new THREE.Euler(pitch, look.yaw, 0, 'YXZ'));
            camera.quaternion.copy(aircraftQuat).multiply(Q_CAMERA_IN_FRD).multiply(lookQuat);
            camera.fov = station === 'radio' ? 60 : look.fov;
        }

        camera.updateProjectionMatrix();
    };

    /** Маркеры упреждения для «Учебного» режима у стрелков (раздел 6.6). */
    const computeMarkers = (): ScreenMarker[] => {
        if (options.difficulty !== 'training' || !input.gunMode() || cameraView !== 'station') {
            return [];
        }

        const out: ScreenMarker[] = [];
        const a = view.aircraft;
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;

        for (const f of view.fighters) {
            if (f.phase === 'down') {
                continue;
            }

            const rx = f.position.x - a.position.x;
            const ry = f.position.y - a.position.y;
            const rz = f.position.z - a.position.z;
            const range = Math.hypot(rx, ry, rz);

            if (range > 1500) {
                continue;
            }

            const tof = range / 820;
            const lead = { x: f.position.x + (f.velocity.x - a.velocity.x) * tof, y: f.position.y + (f.velocity.y - a.velocity.y) * tof, z: f.position.z + (f.velocity.z - a.velocity.z) * tof };
            const p = toThree(lead, tmp).project(camera);

            if (p.z < 1 && Math.abs(p.x) < 1.2 && Math.abs(p.y) < 1.2) {
                out.push({ x: ((p.x + 1) / 2) * width, y: ((1 - p.y) / 2) * height, kind: 'lead', id: f.id });
            }
        }

        return out;
    };

    const animateModel = (dt: number): void => {
        view.aircraft.engines.forEach((engine, i) => {
            const prop = model.propellers[i];

            if (prop) {
                prop.rotation.x += (engine.rpm / 60) * Math.PI * 2 * dt * 0.08;
            }
        });

        for (const leg of model.gear) {
            leg.visible = view.aircraft.gear > 0.05;
            leg.scale.setScalar(Math.max(view.aircraft.gear, 0.05));
        }
    };

    const tick = (now: number): void => {
        if (disposed) {
            return;
        }

        requestAnimationFrame(tick);

        const dt = Math.min((now - last) / 1000, 0.25);

        last = now;
        frame++;
        fps = fps * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05;

        // Автоснижение качества: FPS < 45 дольше 5 с (раздел 12).
        lowFpsSeconds = fps < 45 ? lowFpsSeconds + dt : 0;

        if (lowFpsSeconds > 5 && renderScale > 0.6) {
            renderScale = Math.max(0.6, renderScale - 0.2);
            renderer.setPixelRatio(renderScale);
            resize();
            lowFpsSeconds = 0;
        }

        if (!paused && !pending && view.phase !== 'debrief') {
            // ×2/×4 — только на маршруте без угроз (раздел 8.2); отладочное ×16 — без ограничений.
            const scale = timeScale > 4 || view.canAccelerate ? timeScale : 1;

            accumulator += dt * scale;

            const maxSteps = MAX_STEPS_PER_FRAME * scale;
            const steps = Math.min(Math.floor(accumulator * TICK_HZ), maxSteps);

            if (steps > 0) {
                accumulator -= steps / TICK_HZ;
                pending = true;

                const sample = input.sample(dt, view);

                void sim
                    .advance(sample, steps)
                    .then((next) => {
                        view = next;
                    })
                    .finally(() => {
                        pending = false;
                    });
            }

            accumulator = Math.min(accumulator, maxSteps / TICK_HZ);
        }

        placeCamera();
        animateModel(dt);
        entities.update(view, dt);
        world.update(camera.position.x, -camera.position.z);

        if (panelCtx && cockpit.group.visible && frame % 2 === 0) {
            drawPilotPanel(panelCtx, view.aircraft, view.derived, { pdi: view.sight.on ? (view.sight.readout?.pdi ?? 0) : 0 });
            cockpit.panelTexture.needsUpdate = true;
        }

        renderer.render(world.scene, camera);

        if (frame % 3 === 0) {
            markers = computeMarkers();
            options.onFrame?.({ view, statics, fps, paused, camera: cameraView, scope: input.scope, pointerLocked: input.pointerLocked, timeScale, markers, renderScale });
        }
    };

    const handle: GameHandle = {
        act: (action) => input.push(action),
        setStation: async (next) => {
            if (next === station) {
                return;
            }

            station = next;
            view = await sim.setStation(next);
            input.setStation(next, view);
            look.yaw = 0;
            look.pitch = next === 'navigator' ? -0.5 : -0.12;
            look.fov = 70;

            if (document.pointerLockElement === canvas) {
                document.exitPointerLock();
            }
        },
        toggleView: () => {
            if (options.difficulty === 'training') {
                cameraView = cameraView === 'station' ? 'external' : 'station';
            }
        },
        toggleScope: () => input.toggleScope(),
        togglePause: () => handle.setPaused(!paused),
        setPaused: (value) => {
            paused = value;
            last = performance.now();
        },
        setTimeScale: (value) => {
            timeScale = Math.min(Math.max(1, value), options.maxTimeScale ?? 4);
        },
        setDemo: async (enabled) => {
            await sim.setDemo(enabled);
        },
        setThrottle: (value) => input.setThrottle(value),
        restart: async () => {
            entities.dispose();
            ({ view, statics } = await init());
            entities = createEntities(world.scene, statics);
            input.setStation(station, view);
            accumulator = 0;
        },
        debrief: async () => sim.debrief(),
        dispose: () => {
            disposed = true;
            observer.disconnect();
            input.dispose();
            canvas.removeEventListener('mousedown', onMouseDown);
            window.removeEventListener('mouseup', onMouseUp);
            window.removeEventListener('mousemove', onMouseMove);
            canvas.removeEventListener('wheel', onWheel);
            canvas.removeEventListener('contextmenu', onContextMenu);
            window.removeEventListener('keydown', onKey);
            worker.terminate();
            entities.dispose();
            model.dispose();
            cockpit.dispose();
            world.dispose();
            renderer.dispose();
            canvas.remove();
        },
    };

    requestAnimationFrame(tick);
    canvas.focus();

    return handle;
}
