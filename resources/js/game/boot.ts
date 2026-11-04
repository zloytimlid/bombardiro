import * as Comlink from 'comlink';
import * as THREE from 'three';
import type { AircraftConfig, AircraftInput, Snapshot, TheatreConfig } from '@/sim/core';
import { parseAircraftConfig, ProceduralTerrain, TICK_HZ } from '@/sim/core';
import type { SimWorker } from '@/sim/worker';
import simWorkerUrl from '@/sim/worker?worker&url';
import { PilotKeyboard } from './input/pilotKeyboard';
import { createAircraftModel } from './render/aircraftModel';
import { createCockpit } from './render/cockpit';
import { attitudeToThree, Q_CAMERA_IN_FRD, toThree } from './render/coords';
import { drawPilotPanel, M_TO_FT, MS_TO_MPH } from './render/instruments';
import type { GraphicsPreset } from './render/world';
import { createWorld } from './render/world';

/**
 * Игровой клиент станции «Пилот» (этап 1). Монтируется в любую страницу Inertia,
 * грузится отдельным чанком (раздел 4: code splitting).
 */
export type Difficulty = 'training' | 'historical';
export type CameraView = 'cockpit' | 'external';

export type GameStatus = {
    iasMph: number;
    altitudeFt: number;
    verticalSpeedFpm: number;
    headingDeg: number;
    throttle: number;
    gearDown: boolean;
    flaps: number;
    contact: string;
    touchdownVsMs: number | null;
    view: CameraView;
    paused: boolean;
    fps: number;
    autopilotPhase: string | null;
    renderScale: number;
};

export type GameOptions = {
    config: unknown;
    theatre: TheatreConfig;
    difficulty: Difficulty;
    seed: number;
    graphics?: GraphicsPreset;
    onStatus?: (status: GameStatus) => void;
};

export type GameHandle = {
    toggleView(): void;
    togglePause(): void;
    setAutopilot(enabled: boolean): Promise<void>;
    restart(): Promise<void>;
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

export async function mountGame(container: HTMLElement, options: GameOptions): Promise<GameHandle> {
    // Пропсы Vue — реактивные Proxy, structured clone в воркер их не принимает.
    const rawConfig: unknown = JSON.parse(JSON.stringify(options.config));
    const config: AircraftConfig = parseAircraftConfig(rawConfig);
    const terrain = new ProceduralTerrain(options.theatre);
    const runway = options.theatre.runways[0];

    if (runway === undefined) {
        throw new Error('Theatre has no runway');
    }

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
    const keyboard = new PilotKeyboard(window);

    // Воркер симядра.
    const worker = createSimWorker();
    const sim = Comlink.wrap<SimWorker>(worker);

    const startOnRunway = async (): Promise<Snapshot> => {
        const y = runway.y - runway.length_m / 2 + 60;

        keyboard.reset({ throttle: 0, gearDown: true, flaps: 0.25 });

        return sim.init({
            config: rawConfig,
            theatre: options.theatre,
            seed: options.seed,
            initial: {
                position: { x: runway.x, y, z: terrain.heightAt(runway.x, y) + 2.0 },
                heading: runway.heading,
                speed: 0,
                gearDown: true,
                flaps: 0.25,
                enginesRunning: true,
                onGround: true,
                loadout: { crew: 6, ammoKg: 300, bombsKg: 0, fuelKg: 14500 - config.mass.empty_kg.value - 6 * 90 - 300 },
            },
        });
    };

    let snapshot = await startOnRunway();
    let view: CameraView = 'cockpit';
    let paused = false;
    let pending = false;
    let accumulator = 0;
    let last = performance.now();
    let frame = 0;
    let fps = 60;
    let lowFpsSeconds = 0;
    let autopilotPhase: string | null = null;
    let disposed = false;
    const look = { yaw: 0, pitch: -0.12, fov: 70 };

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
        if (looking) {
            look.yaw = THREE.MathUtils.clamp(look.yaw - e.movementX * 0.004, -2.6, 2.6);
            look.pitch = THREE.MathUtils.clamp(look.pitch - e.movementY * 0.004, -1.2, 1.2);
        }
    };
    const onWheel = (e: WheelEvent): void => {
        e.preventDefault();
        look.fov = THREE.MathUtils.clamp(look.fov + Math.sign(e.deltaY) * 4, 25, 90);
    };
    const onContextMenu = (e: Event): void => e.preventDefault();
    const onKey = (e: KeyboardEvent): void => {
        if (e.code === 'KeyV' && options.difficulty === 'training') {
            handle.toggleView();
        } else if (e.code === 'KeyH') {
            look.yaw = 0;
            look.pitch = -0.12;
            look.fov = 70;
        } else if (e.code === 'KeyP') {
            handle.togglePause();
        }
    };
    const canvas = renderer.domElement;

    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('keydown', onKey);

    const eye = config.geometry.pilot_eye_m.value;
    const aircraftQuat = new THREE.Quaternion();
    const lookQuat = new THREE.Quaternion();
    const tmp = new THREE.Vector3();

    const placeCamera = (): void => {
        const a = snapshot.aircraft;

        attitudeToThree(a.attitude, aircraftQuat);
        model.root.position.copy(toThree(a.position, tmp));
        model.root.quaternion.copy(aircraftQuat);

        for (const part of model.exteriorOnly) {
            part.visible = view === 'external';
        }

        cockpit.group.visible = view === 'cockpit';

        if (view === 'cockpit') {
            const eyeWorld = new THREE.Vector3(eye[0], eye[1], eye[2]).applyQuaternion(aircraftQuat).add(model.root.position);

            lookQuat.setFromEuler(new THREE.Euler(look.pitch, look.yaw, 0, 'YXZ'));
            camera.position.copy(eyeWorld);
            camera.quaternion.copy(aircraftQuat).multiply(Q_CAMERA_IN_FRD).multiply(lookQuat);
            camera.fov = look.fov;
        } else {
            // Внешняя камера сзади-сверху (только «Учебный» режим и разбор).
            const behind = new THREE.Vector3(-32, 0, -9).applyQuaternion(aircraftQuat);

            behind.y = Math.max(behind.y, 4);
            camera.position.copy(model.root.position).add(behind);
            camera.up.set(0, 1, 0);
            camera.lookAt(model.root.position);
            camera.fov = 55;
        }

        camera.updateProjectionMatrix();
    };

    const animateModel = (dt: number): void => {
        snapshot.aircraft.engines.forEach((engine, i) => {
            const prop = model.propellers[i];

            if (prop) {
                prop.rotation.x += (engine.rpm / 60) * Math.PI * 2 * dt * 0.08;
            }
        });

        for (const leg of model.gear) {
            leg.visible = snapshot.aircraft.gear > 0.05;
            leg.scale.setScalar(Math.max(snapshot.aircraft.gear, 0.05));
        }
    };

    const reportStatus = (): void => {
        const d = snapshot.derived;
        const kb = keyboard.status;

        options.onStatus?.({
            iasMph: d.indicatedAirspeed * MS_TO_MPH,
            altitudeFt: d.altitude * M_TO_FT,
            verticalSpeedFpm: d.verticalSpeed * M_TO_FT * 60,
            headingDeg: (d.heading * 180) / Math.PI,
            throttle: kb.throttle,
            gearDown: kb.gearDown,
            flaps: kb.flaps,
            contact: snapshot.aircraft.contact,
            touchdownVsMs: snapshot.aircraft.touchdownVs,
            view,
            paused,
            fps,
            autopilotPhase,
            renderScale,
        });
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

        const input: AircraftInput = keyboard.sample(dt);

        if (!paused && !pending) {
            accumulator += dt;

            const steps = Math.min(Math.floor(accumulator * TICK_HZ), MAX_STEPS_PER_FRAME);

            if (steps > 0) {
                accumulator -= steps / TICK_HZ;
                pending = true;
                void sim
                    .advance(input, steps)
                    .then(async (next) => {
                        snapshot = next;
                        autopilotPhase = await sim.autopilotPhase();
                    })
                    .finally(() => {
                        pending = false;
                    });
            }

            accumulator = Math.min(accumulator, MAX_STEPS_PER_FRAME / TICK_HZ);
        }

        placeCamera();
        animateModel(dt);

        if (panelCtx && view === 'cockpit' && frame % 2 === 0) {
            drawPilotPanel(panelCtx, snapshot.aircraft, snapshot.derived, { pdi: 0 });
            cockpit.panelTexture.needsUpdate = true;
        }

        renderer.render(world.scene, camera);

        if (frame % 10 === 0) {
            reportStatus();
        }
    };

    const handle: GameHandle = {
        toggleView: () => {
            if (options.difficulty === 'training') {
                view = view === 'cockpit' ? 'external' : 'cockpit';
            }
        },
        togglePause: () => {
            paused = !paused;
            last = performance.now();
        },
        setAutopilot: async (enabled) => {
            await sim.setAutopilot(enabled);
        },
        restart: async () => {
            snapshot = await startOnRunway();
            accumulator = 0;
        },
        dispose: () => {
            disposed = true;
            observer.disconnect();
            keyboard.dispose();
            canvas.removeEventListener('mousedown', onMouseDown);
            window.removeEventListener('mouseup', onMouseUp);
            window.removeEventListener('mousemove', onMouseMove);
            canvas.removeEventListener('wheel', onWheel);
            canvas.removeEventListener('contextmenu', onContextMenu);
            window.removeEventListener('keydown', onKey);
            worker.terminate();
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
