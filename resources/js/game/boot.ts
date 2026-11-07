import * as Comlink from 'comlink';
import * as THREE from 'three';
import type { AircraftConfig, Debrief, Difficulty, Station, TheatreConfig, WorldAction } from '@/sim/core';
import { createTerrain, mountDirectionBody, parseAircraftConfig, parseMission, STATIONS, TICK_HZ } from '@/sim/core';
import type { MissionStatic, WorldView } from '@/sim/view';
import type { SimWorker } from '@/sim/worker';
import simWorkerUrl from '@/sim/worker?worker&url';
import type { NetBootstrapData, UserSettingsData } from '@/types/generated/net';
import type { Volumes } from './audio/sound';
import { createSound } from './audio/sound';
import { indexBindings } from './input/bindings';
import { StationInput } from './input/stationInput';
import { api } from './net/api';
import type { NetCallbacks, NetStatus } from './net/netSession';
import type { VoiceCallbacks } from './net/voice';
import { FlightLink } from './net/flightLink';
import { NetSession } from './net/netSession';
import { createAircraftModel } from './render/aircraftModel';
import { NOSE_ART_URL } from './render/noseArt';
import { createCockpit } from './render/cockpit';
import { createCrewInteriors, SHELL_HIDDEN_FROM } from './render/crewInterior';
import { attitudeToThree, Q_CAMERA_IN_FRD, toThree } from './render/coords';
import { createEntities } from './render/entities';
import { drawPilotPanel } from './render/instruments';
import type { GraphicsPreset } from './render/world';
import { createRenderer } from './render/renderer';
import { createWorld } from './render/world';
import { inputPrefsFrom, volumesFrom, withDefaults } from './settings';

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
    /** Кооператив: роль, хост, миграция, RTT (null — одиночный режим). */
    net: NetStatus | null;
};

/** Кооперативный вылет (этап 3): сессия, места игроков, отладочная задержка сети. */
export type NetGameOptions = {
    bootstrap: NetBootstrapData;
    humans: Station[];
    delayMs: number;
    callbacks: Omit<NetCallbacks, 'onStatus'>;
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
    net?: NetGameOptions;
    /** Настройки игрока (управление, графика, звук, доступность); null — гость. */
    settings?: UserSettingsData | null;
    /** Слать агрегированную телеметрию FPS/RTT (только вошедший игрок). */
    telemetry?: boolean;
    /** Кампания (этап 6): прочность зон борта 0…1 в начале вылета. */
    initialZones?: Record<string, number>;
    /** Звено (этап 6): канал звена, своё место в строю и название экипажа. */
    flight?: { ulid: string; slot: number; name: string } | null;
};

/** Ведомые экипажи звена взлетают по очереди: 35 с на место в строю. */
const FLIGHT_TAKEOFF_SPACING_S = 35;

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
    /** Кооператив: «ИИ на моём месте» и чат экипажа. */
    setSeatAi(on: boolean): void;
    sendChat(text: string): void;
    /** Голосовое СПУ (этап 6): включить, выключить, тангента. */
    enableVoice(iceServers: RTCIceServer[], callbacks: VoiceCallbacks): Promise<void>;
    disableVoice(): void;
    setTalking(on: boolean): void;
    /** Кооператив: хост дождался выгрузки журнала и итога на сервер. */
    flushed(): Promise<void>;
    /** Громкость по категориям (раздел 12). */
    setVolumes(v: Volumes): void;
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
    const terrain = createTerrain(options.theatre);

    const settings = withDefaults(options.settings);
    const graphics = options.graphics ?? (settings.graphics === 'low' || settings.graphics === 'high' ? settings.graphics : 'medium');
    const renderer = await createRenderer(settings.renderer === 'webgpu' ? 'webgpu' : 'webgl', graphics !== 'low');
    let renderScale = Math.min(window.devicePixelRatio, 1.5) * settings.render_scale;

    renderer.setPixelRatio(renderScale);
    container.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';
    renderer.domElement.tabIndex = 0;

    const world = createWorld(terrain, options.theatre.runways, graphics);
    const model = createAircraftModel({ name: config.airframe.name, serial: config.airframe.serial, code: config.airframe.code });

    model.setNoseArt(NOSE_ART_URL);
    const cockpit = createCockpit();

    model.root.add(cockpit.group);

    // Отсеки экипажа для вида от первого лица — в осях модели, движутся вместе с ней.
    const interiors = createCrewInteriors();

    model.root.add(interiors.group);
    world.scene.add(model.root);

    const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 90000);
    const panelCtx = cockpit.panelCanvas.getContext('2d');
    const canvas = renderer.domElement;
    const input = new StationInput(window, canvas, inputPrefsFrom(settings));
    const bindings = indexBindings(inputPrefsFrom(settings).bindings);
    const sound = createSound(window);

    sound.setVolumes(volumesFrom(settings));

    const worker = createSimWorker();
    const sim = Comlink.wrap<SimWorker>(worker);
    let station: Station = options.station;

    const init = async (): Promise<{ view: WorldView; statics: MissionStatic }> =>
        sim.init({
            mode: options.mode,
            config: rawConfig,
            mission: rawMission,
            theatre: options.theatre,
            difficulty: options.difficulty,
            seed: options.seed,
            station,
            humans: options.net?.humans,
            initialZones: options.initialZones,
            takeoffDelayS: (options.flight?.slot ?? 0) * FLIGHT_TAKEOFF_SPACING_S,
        });

    let { view, statics } = await init();
    let entities = createEntities(world.scene, statics);

    input.setStation(station, view);

    // Звено: самолёты других экипажей — по каналу звена (только картинка, физика у каждого своя).
    const flightLink = options.flight ? new FlightLink(options.flight.ulid, options.flight.slot, options.flight.name) : null;
    const flightModels = new Map<number, ReturnType<typeof createAircraftModel>>();
    const flightQuat = new THREE.Quaternion();
    const updateFlight = (now: number): void => {
        if (!flightLink) {
            return;
        }

        // Публикует хост экипажа (у него настоящее состояние мира).
        if (net === null || (net.role === 'host' && !net.restoring)) {
            flightLink.publish(view, now);
        }

        const seen = new Set<number>();

        for (const peer of flightLink.others(now)) {
            let m = flightModels.get(peer.slot);

            if (!m) {
                m = createAircraftModel({ name: peer.name, serial: '', code: '' });
                world.scene.add(m.root);
                flightModels.set(peer.slot, m);
            }

            seen.add(peer.slot);
            toThree({ x: peer.p[0], y: peer.p[1], z: peer.p[2] }, m.root.position);
            attitudeToThree({ w: peer.q[0], x: peer.q[1], y: peer.q[2], z: peer.q[3] }, flightQuat);
            m.root.quaternion.copy(flightQuat);
            m.propellers.forEach((prop) => (prop.rotation.x += 0.9));
        }

        for (const [slot, m] of flightModels) {
            m.root.visible = seen.has(slot);
        }
    };

    // Кооператив: хост считает мир у себя, клиент рисует снапшоты хоста (раздел 9).
    let netStatus: NetStatus | null = null;
    let net: NetSession | null = null;

    if (options.net) {
        const weather = parseMission(rawMission).weather;

        net = new NetSession(
            options.net.bootstrap,
            sim,
            NetSession.decodeContext(config, terrain, { wind: weather.wind, turbulence_ms: weather.turbulence_ms }, statics),
            station,
            {
                ...options.net.callbacks,
                onStatus: (s) => {
                    netStatus = s;
                },
            },
            options.net.delayMs,
        );
        net.stationListeners.push((seat) => void applyStation(seat));
        net.start();
    }

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
        if (e.repeat || (e.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName))) {
            return;
        }

        for (const action of bindings.get(e.code) ?? []) {
            const digit = /^station_([1-8])$/.exec(action);

            if (digit) {
                const next = STATIONS[Number(digit[1]) - 1];

                if (next) {
                    void handle.setStation(next);
                }
            } else if (action === 'external_view' && options.difficulty === 'training') {
                handle.toggleView();
            } else if (action === 'look_reset') {
                look.yaw = 0;
                look.pitch = station === 'navigator' ? -0.5 : -0.12;
                look.fov = 70;
            } else if (action === 'pause') {
                handle.togglePause();
            }
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

        // Вид от первого лица: отсек места (стенки с окнами, кресла, оборудование). Обшивка и остекление скрыты, если
        // глаз внутри фюзеляжа (пилоты, штурман, радист, бортовой стрелок); под остеклением (бомбардир, верхний и
        // хвостовой стрелки) наружная модель видна. Приборная доска — пилотам и штурману (она перед ним за креслами).
        const aboard = cameraView === 'station';
        const hideShell = aboard && SHELL_HIDDEN_FROM.has(station);

        for (const part of model.exteriorOnly) {
            part.visible = !hideShell;
        }

        interiors.show(aboard ? station : null);
        cockpit.group.visible = aboard && (COCKPIT_STATIONS.includes(station) || station === 'navigator');

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
        // Тряску камеры можно отключить (раздел 12, доступность).
        const intensity = settings.camera_shake && hit !== null && hit < 0.4 ? (0.4 - hit) * 0.25 : 0;

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

        if (net !== null && (net.role === 'client' || net.restoring)) {
            // Клиент: свой ввод хосту, мир — интерполированные снапшоты хоста.
            const sample = input.sample(dt, view);

            net.sendInput(sample.controls, sample.actions, now);
            view = net.view(now) ?? view;
        } else if (!paused && !pending && view.phase !== 'debrief') {
            // ×2/×4 — только на маршруте без угроз (раздел 8.2); отладочное ×16 — без ограничений.
            const scale = timeScale > 4 || view.canAccelerate ? timeScale : 1;

            accumulator += dt * scale;

            const maxSteps = MAX_STEPS_PER_FRAME * scale;
            const steps = Math.min(Math.floor(accumulator * TICK_HZ), maxSteps);

            if (steps > 0) {
                accumulator -= steps / TICK_HZ;
                pending = true;

                const sample = input.sample(dt, view);
                const remote = net?.takeRemoteInputs() ?? [];

                void sim
                    .advance(sample, steps, remote)
                    .then((next) => {
                        view = next;
                        void net?.afterHostFrame(next, performance.now());
                    })
                    .finally(() => {
                        pending = false;
                    });
            }

            accumulator = Math.min(accumulator, maxSteps / TICK_HZ);
        }

        placeCamera();
        animateModel(dt);
        updateFlight(now);
        entities.update(view, dt);
        world.update(camera.position.x, -camera.position.z);

        if (panelCtx && cockpit.group.visible && frame % 2 === 0) {
            drawPilotPanel(panelCtx, view.aircraft, view.derived, { pdi: view.sight.on ? (view.sight.readout?.pdi ?? 0) : 0 });
            cockpit.panelTexture.needsUpdate = true;
        }

        renderer.render(world.scene, camera);

        if (frame % 2 === 0) {
            sound.update(view, station);
        }

        if (frame % 3 === 0) {
            markers = computeMarkers();
            options.onFrame?.({ view, statics, fps, paused, camera: cameraView, scope: input.scope, pointerLocked: input.pointerLocked, timeScale, markers, renderScale, net: netStatus });
        }
    };

    async function applyStation(next: Station): Promise<void> {
        if (next === station) {
            return;
        }

        station = next;

        // У клиента мир в воркере не идёт — станция нужна только для ввода и камеры.
        if (net === null || net.role === 'host') {
            view = await sim.setStation(next);
        }

        input.setStation(next, view);
        look.yaw = 0;
        look.pitch = next === 'navigator' ? -0.5 : -0.12;
        look.fov = 70;

        if (document.pointerLockElement === canvas) {
            document.exitPointerLock();
        }
    }

    const handle: GameHandle = {
        act: (action) => input.push(action),
        setStation: async (next) => {
            if (net !== null) {
                // Кооператив: место через сервер (409 — занято), переход через 3 с (раздел 6.7).
                if (next !== station && netStatus?.seatChangeAt == null) {
                    await net.requestSeat(next);
                }

                return;
            }

            await applyStation(next);
        },
        toggleView: () => {
            if (options.difficulty === 'training') {
                cameraView = cameraView === 'station' ? 'external' : 'station';
            }
        },
        toggleScope: () => input.toggleScope(),
        togglePause: () => handle.setPaused(!paused),
        setPaused: (value) => {
            // В кооперативе мир общий — пауза недоступна.
            paused = net === null && value;
            sound.setPaused(paused);
            last = performance.now();
        },
        setTimeScale: (value) => {
            // В кооперативе ускоряет только хост; клиенты видят ускорение через снапшоты.
            timeScale = net !== null && net.role !== 'host' ? 1 : Math.min(Math.max(1, value), options.maxTimeScale ?? 4);
        },
        setDemo: async (enabled) => {
            if (net !== null) {
                net.setSeatAi(enabled);

                return;
            }

            await sim.setDemo(enabled);
        },
        setThrottle: (value) => input.setThrottle(value),
        restart: async () => {
            if (net !== null) {
                return;
            }

            entities.dispose();
            ({ view, statics } = await init());
            entities = createEntities(world.scene, statics);
            input.setStation(station, view);
            accumulator = 0;
        },
        debrief: async () => sim.debrief(),
        setSeatAi: (on) => net?.setSeatAi(on),
        sendChat: (text) => net?.sendChat(text),
        enableVoice: async (ice, callbacks) => net?.enableVoice(ice, callbacks, volumesFrom(settings).intercom),
        disableVoice: () => net?.disableVoice(),
        setTalking: (on) => net?.setTalking(on),
        flushed: async () => net?.flushed(),
        setVolumes: (v) => sound.setVolumes(v),
        dispose: () => {
            disposed = true;

            if (telemetryTimer !== null) {
                window.clearInterval(telemetryTimer);
            }

            net?.dispose();
            flightLink?.dispose();
            flightModels.forEach((m) => {
                world.scene.remove(m.root);
                m.dispose();
            });
            sound.dispose();
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
            interiors.dispose();
            world.dispose();
            renderer.dispose();
            canvas.remove();
        },
    };

    // Телеметрия (раздел 13): средний FPS и RTT раз в 30 с, только агрегатом.
    let telemetryTimer: number | null = null;

    if (options.telemetry) {
        telemetryTimer = window.setInterval(() => {
            if (!document.hidden) {
                void api('POST', '/api/telemetry', { fps: Math.round(fps), preset: graphics, rtt_ms: netStatus?.rttMs ?? null, mode: net ? 'crew' : options.mode === 'training' ? 'training' : 'solo' }).catch(() => undefined);
            }
        }, 30000);
    }

    requestAnimationFrame(tick);
    canvas.focus();

    return handle;
}
