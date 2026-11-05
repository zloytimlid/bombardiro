import type { AircraftDerived, AircraftInput, AircraftState } from './aircraft';
import { defaultInput, totalFuel } from './aircraft';
import type { WeatherConfig } from './atmosphere';
import { isa, SEA_LEVEL, windAt } from './atmosphere';
import type { BallisticTable, Bullet, FallingBomb } from './ballistics';
import { buildBallisticTable, segmentSphere, stepBomb, stepBullet } from './ballistics';
import type { BombsightState, SightReadout } from './bombsight';
import { activateSight, createBombsight, nudgeCrosshair, readSight, shouldRelease, stepBombsight } from './bombsight';
import type { ChecklistId, ChecklistState } from './checklists';
import { CHECKLIST_PHASE, CHECKLISTS, checkItem, createChecklists, missedItems } from './checklists';
import type { AircraftConfig, Station, ZoneId } from './config';
import { STATIONS } from './config';
import type { ContentLibrary, Skill } from './content';
import { bombType, fighterType, flakType } from './content';
import type { CrewState } from './crew';
import { addThreat, createCrew, expireThreats, isActive, isAvailable, say, THREAT_TTL_S, treat } from './crew';
import type { DamageContext, DamageState } from './damage';
import { applyHit, createDamage, extinguishEngine, extinguishFuselage, failed, pickWeighted, raycastZones, stepDamage, zoneWeights } from './damage';
import type { Fighter } from './fighters';
import { createFighter, stepFighter } from './fighters';
import type { FlakBattery, FlakBurst } from './flak';
import { expectedFragments, poisson, stepBattery } from './flak';
import type { MountCommand, MountState } from './guns';
import { createMounts, stepMount } from './guns';
import type { Vec3 } from './math';
import { add, clamp, length, normalize, rotate, rotateInverse, scale, sub, vec, wrapPi } from './math';
import { bearing, distance2, toEnu } from './mission/geo';
import type { MissionAction, MissionDefinition, MissionTarget, RadioMeaning, WaypointType } from './mission/schema';
import type { NavigatorState } from './navigation';
import { applyFix, courseToSteer as courseToSteerFor, createNavigator, solveWind, stepDeadReckoning } from './navigation';
import type { RadioState, ReceivedMessage } from './radio';
import { createRadio, decode, stepRadio, transmit } from './radio';
import { hash32, Rng } from './rng';
import { DT, hashState, Simulation, TICK_HZ } from './simulation';
import type { Runway, Terrain, TheatreConfig } from './terrain';
import { ProceduralTerrain } from './terrain';

/**
 * Мир вылета (этап 2): бомбардировщик, 8 станций, ИИ-экипаж, повреждения, зенитки,
 * истребители, ведомые, фазы миссии (раздел 8.2) и триггеры (раздел 8.3).
 * Чистый TS, фиксированный шаг 60 Гц, все случайности — из ГПСЧ с сидом.
 */
export const PHASES = ['preflight', 'takeoff', 'formup', 'route', 'bomb_run', 'egress', 'return', 'landing', 'debrief'] as const;
export type Phase = (typeof PHASES)[number];
export type Difficulty = 'training' | 'historical';

export type FlightControls = {
    pitch: number;
    roll: number;
    yaw: number;
    brakeLeft: number;
    brakeRight: number;
    trimPitchRate: number;
    trimRollRate: number;
    trimYawRate: number;
    throttle: [number, number];
    fireFixed: boolean;
};

export type EngineControlsSet = {
    prop: [number, number];
    mixture: [number, number];
    cowl: [number, number];
    magnetos: [boolean, boolean];
    starter: [boolean, boolean];
    primer: [boolean, boolean];
    feather: [boolean, boolean];
};

export type CopilotControls = EngineControlsSet & { gearDown: boolean; flaps: number; battery: boolean; fuelPump: boolean };

/** Приказы пилота второму пилоту по СПУ (шасси, закрылки). */
export type PilotOrders = { gearDown: boolean | null; flaps: number | null; issuedTick: number };

export type WorldEvent = { tick: number; type: string; payload: Record<string, unknown> };

export type WaypointRuntime = { id: string; type: WaypointType; position: Vec3; speedMs: number | null };

export type TargetSection = { id: string; center: Vec3; halfLength: number; halfWidth: number; strength: number; damage: number };

export type TargetRuntime = { def: MissionTarget; aim: Vec3; heading: number; sections: TargetSection[] };

export type Impact = { bombId: number; typeId: string; position: Vec3; missM: number; armed: boolean; tick: number; onTarget: boolean };

export type Wingman = { id: number; slot: Vec3; position: Vec3; velocity: Vec3; joined: boolean };

export type Outcome = 'landed' | 'belly_landed' | 'ditched' | 'crashed' | 'bailed_out' | 'landed_off_field';

export type WorldAction =
    | { type: 'gear'; down: boolean }
    | { type: 'flaps'; value: number }
    | { type: 'engine'; index: 0 | 1; field: keyof EngineControlsSet; value: number | boolean }
    | { type: 'battery'; on: boolean }
    | { type: 'fuel_pump'; on: boolean }
    | { type: 'extinguish'; index: 0 | 1 }
    | { type: 'take_control' }
    | { type: 'confirm_handover' }
    | { type: 'checklist'; list: ChecklistId; item: string }
    | { type: 'oxygen'; on: boolean }
    | { type: 'sight_on' }
    | { type: 'sight_adjust'; rate?: number; drift?: number; along?: number; across?: number }
    | { type: 'sight_set'; altitudeM?: number; tasMs?: number }
    | { type: 'doors'; open: boolean }
    | { type: 'arm'; on: boolean }
    | { type: 'release_mode'; mode: 'salvo' | 'train'; intervalMs?: number }
    | { type: 'auto_release'; on: boolean }
    | { type: 'release' }
    | { type: 'salvo' }
    | { type: 'nav_drift'; driftRad: number; groundSpeedMs: number }
    | { type: 'nav_fix'; landmark: string }
    | { type: 'nav_leg'; index: number }
    | { type: 'radio_dial'; mhz: number }
    | { type: 'decode'; messageId: string; meaning: RadioMeaning }
    | { type: 'iff'; on: boolean }
    | { type: 'distress' }
    | { type: 'task'; kind: 'extinguish' | 'first_aid' | 'emergency_gear' | 'fuel_transfer'; target?: string }
    | { type: 'intercom'; key: string; params?: Record<string, string | number> }
    | { type: 'report_threat'; clock: number; level: 'high' | 'level' | 'low'; kind?: 'fighter' | 'flak' }
    | { type: 'order'; order: 'report_ready' | 'stations' | 'prepare_bailout' | 'bailout' | 'cancel_bailout' }
    | { type: 'jump' };

/** Непрерывный ввод игрока на его станции за тик. */
export type HumanControls = { flight?: Partial<FlightControls>; mount?: MountCommand; mountId?: string };

export type StationAI = { update(world: MissionWorld, dt: number): void };
export type StationAIFactory = (station: Station, world: MissionWorld) => StationAI | null;

export type WorldStart = {
    phase?: Phase;
    position?: Vec3;
    heading?: number;
    speedMs?: number;
    enginesRunning?: boolean;
    gearDown?: boolean;
    /** Индекс следующей путевой точки (тренировки, старт в воздухе). */
    legIndex?: number;
    bombs?: { type: string; count: number }[];
};

export type WorldOptions = {
    config: AircraftConfig;
    content: ContentLibrary;
    mission: MissionDefinition;
    theatre: TheatreConfig;
    difficulty: Difficulty;
    skill?: Skill;
    humans?: Station[];
    seed?: number;
    terrain?: Terrain;
    start?: WorldStart;
    aiFactory?: StationAIFactory;
    /** Станции без ИИ (тренировки: остальные стрелки молчат). */
    aiDisabled?: Station[];
    /** Своя логика фаз (тренировки); true — стандартная логика этого тика пропускается. */
    phaseHook?: (world: MissionWorld) => boolean;
};

export type Metrics = {
    bombRun: { samples: number; headingSq: number; altitudeSq: number; speedSq: number; refAltitude: number | null; refIas: number | null; refCourse: number | null };
    formationS: number;
    fuelAtStartKg: number;
    missedChecklistItems: number;
    threatReportDelays: number[];
    fighterFirstSeenTick: Record<number, number>;
    fighterReported: Record<number, boolean>;
    kills: Record<string, number>;
    damagedFighters: Record<string, number>;
    flakBurstsNear: number;
    timeOverTargetS: number | null;
    ipTick: number | null;
};

const DEFAULT_INTERVAL_TICKS = 6;
const isaDensityRatio = (altitude: number): number => isa(altitude).density / SEA_LEVEL.density;
const BOMBER_RADIUS_M = 11;
const MAX_BULLETS = 400;
const BURST_VISIBLE_S = 8;
const IMPACT_VISIBLE_S = 25;

export const defaultFlightControls = (): FlightControls => ({
    pitch: 0,
    roll: 0,
    yaw: 0,
    brakeLeft: 0,
    brakeRight: 0,
    trimPitchRate: 0,
    trimRollRate: 0,
    trimYawRate: 0,
    throttle: [0, 0],
    fireFixed: false,
});

export const defaultCopilotControls = (running: boolean): CopilotControls => ({
    prop: [1, 1],
    mixture: [running ? 1 : 0, running ? 1 : 0],
    cowl: [0.6, 0.6],
    magnetos: [running, running],
    starter: [false, false],
    primer: [false, false],
    feather: [false, false],
    gearDown: true,
    flaps: 0,
    battery: true,
    fuelPump: true,
});

export class MissionWorld {
    readonly config: AircraftConfig;
    readonly content: ContentLibrary;
    readonly mission: MissionDefinition;
    readonly theatre: TheatreConfig;
    readonly terrain: Terrain;
    readonly difficulty: Difficulty;
    readonly sim: Simulation;
    readonly weather: WeatherConfig;
    readonly runway: Runway;
    readonly rng: Rng;
    readonly crew: CrewState;
    readonly damage: DamageState;
    readonly checklists: ChecklistState;
    readonly mounts: MountState[];
    readonly mountCommands: Record<string, MountCommand> = {};
    readonly waypoints: WaypointRuntime[];
    readonly landmarks: { id: string; position: Vec3; kind: string }[];
    readonly beacon: Vec3;
    readonly tables = new Map<string, BallisticTable>();
    readonly nav: NavigatorState;
    readonly radio: RadioState;
    readonly events: WorldEvent[] = [];
    readonly metrics: Metrics;

    phase: Phase;
    phaseStartTick = 0;
    pilot: FlightControls = defaultFlightControls();
    copilot: CopilotControls;
    /** Ручки второго пилота для пилотирования после передачи управления. */
    copilotFlight: FlightControls = defaultFlightControls();
    orders: PilotOrders = { gearDown: null, flaps: null, issuedTick: 0 };
    sight: BombsightState = createBombsight();
    doorsCommand = false;
    rack: string[] = [];
    releaseQueue: { typeId: string; tick: number; armed: boolean }[] = [];
    bombs: FallingBomb[] = [];
    impacts: Impact[] = [];
    bullets: Bullet[] = [];
    fighters: Fighter[] = [];
    batteries: FlakBattery[] = [];
    bursts: FlakBurst[] = [];
    wingmen: Wingman[] = [];
    target: TargetRuntime;
    knownTargetId: string;
    alternateTargets: TargetRuntime[];
    triggersFired = new Set<string>();
    recallKnown = false;
    outcome: Outcome | null = null;
    aircraftLost = false;
    humans: Station[];
    ai: Partial<Record<Station, StationAI>> = {};

    readonly track: { t: number; x: number; y: number; z: number }[] = [];
    readonly aiDisabled: Station[];
    private readonly phaseHook: ((world: MissionWorld) => boolean) | null;
    private nextId = 1;
    private announcedCourse: number | null = null;
    private lastCourseTick = -100000;
    private prevBomberPosition: Vec3;
    private lastFlakTick = -100000;
    private readonly aiFactory: StationAIFactory | null;

    constructor(options: WorldOptions) {
        const { config, mission, theatre } = options;

        this.config = config;
        this.content = options.content;
        this.mission = mission;
        this.theatre = theatre;
        this.difficulty = options.difficulty;
        this.terrain = options.terrain ?? new ProceduralTerrain(theatre);
        this.humans = [...(options.humans ?? [])];
        this.aiFactory = options.aiFactory ?? null;
        this.aiDisabled = options.aiDisabled ?? [];
        this.phaseHook = options.phaseHook ?? null;

        const seed = (options.seed ?? mission.seed) >>> 0;

        this.rng = new Rng(hash32(seed, 0x5eed));
        this.weather = { wind: mission.weather.wind, turbulence_ms: mission.weather.turbulence_ms };

        const runway = theatre.runways.find((r) => r.id === mission.start.runway) ?? theatre.runways[0];

        if (runway === undefined) {
            throw new Error('Theatre has no runway');
        }

        this.runway = runway;
        this.waypoints = mission.waypoints.map((w) => ({
            id: w.id,
            type: w.type,
            position: toEnu(theatre, w.lat, w.lon, w.alt_m),
            speedMs: w.speed_kmh !== undefined ? w.speed_kmh / 3.6 : null,
        }));
        this.landmarks = mission.landmarks.map((l) => ({ id: l.id, position: toEnu(theatre, l.lat, l.lon), kind: l.kind }));
        this.beacon = toEnu(theatre, mission.radio.beacon.lat, mission.radio.beacon.lon);
        this.target = this.buildTarget(mission.target);
        this.alternateTargets = mission.alternate_targets.map((t) => this.buildTarget(t));
        this.knownTargetId = mission.target.id;

        // Загрузка.
        const start = options.start ?? {};
        const bombs = start.bombs ?? mission.loadout.bombs;

        for (const b of bombs) {
            const type = bombType(this.content, b.type);

            for (let i = 0; i < b.count; i++) {
                this.rack.push(type.id);
            }

            if (!this.tables.has(type.id)) {
                this.tables.set(type.id, buildBallisticTable(type));
            }
        }

        const bombsKg = this.rack.reduce((sum, id) => sum + bombType(this.content, id).mass_kg.value, 0);
        const running = start.enginesRunning ?? mission.start.engines_running;
        const airborne = start.position !== undefined && start.position.z - this.terrain.heightAt(start.position.x, start.position.y) > 20;
        const startPosition =
            start.position ?? vec(runway.x - Math.sin(runway.heading) * (runway.length_m / 2 - 60), runway.y - Math.cos(runway.heading) * (runway.length_m / 2 - 60), 0);
        const groundZ = this.terrain.heightAt(startPosition.x, startPosition.y);

        this.sim = new Simulation({
            config,
            terrain: this.terrain,
            seed,
            weather: this.weather,
            initial: {
                position: airborne ? startPosition : { ...startPosition, z: groundZ + 2.0 },
                heading: start.heading ?? runway.heading,
                speed: start.speedMs ?? 0,
                pitch: airborne ? 0.03 : 0,
                gearDown: start.gearDown ?? !airborne,
                flaps: 0,
                enginesRunning: running,
                onGround: !airborne,
                loadout: { crew: 8, ammoKg: 400, bombsKg, fuelKg: mission.loadout.fuel_kg },
            },
        });

        this.prevBomberPosition = { ...this.sim.aircraft.position };
        this.copilot = defaultCopilotControls(running);
        this.copilot.gearDown = start.gearDown ?? !airborne;

        if (running) {
            const throttle = airborne ? 0.75 : 0;

            this.pilot.throttle = [throttle, throttle];
        }

        this.crew = createCrew(options.skill ?? 'experienced', this.humans);
        this.damage = createDamage(config);
        this.checklists = createChecklists();
        this.mounts = createMounts(config, this.content.gun);

        for (const m of this.mounts) {
            this.mountCommands[m.id] = { fire: false, clearJam: false };
        }

        // Прогноз ветра на брифинге — с ошибкой: штурман уточняет его по сносу (раздел 6.3).
        const trueWind = windAt(this.weather, this.waypoints[2]?.position.z ?? 3000);
        const turn = this.rng.gaussian(0, 0.35);
        const gain = clamp(1 + this.rng.gaussian(0, 0.3), 0.4, 1.6);
        const briefedWind = {
            x: gain * (trueWind.x * Math.cos(turn) - trueWind.y * Math.sin(turn)),
            y: gain * (trueWind.x * Math.sin(turn) + trueWind.y * Math.cos(turn)),
        };

        this.nav = createNavigator({ x: startPosition.x, y: startPosition.y }, briefedWind);
        this.nav.legIndex = start.legIndex ?? 1;
        this.radio = createRadio();
        this.radio.dialMhz = mission.radio.frequencies_mhz.command;

        for (const b of mission.threats.flak) {
            const p = toEnu(theatre, b.lat, b.lon, b.elevation_m);

            this.batteries.push({
                id: b.id,
                typeId: b.type,
                position: p,
                guns: b.guns,
                active: b.active,
                barrage: b.barrage,
                cooldownS: this.rng.range(0, flakType(this.content, b.type).interval_s),
                trackingS: 0,
                refHeading: null,
                refAltitude: null,
                refTimerS: 0,
                shots: 0,
            });
        }

        this.metrics = {
            bombRun: { samples: 0, headingSq: 0, altitudeSq: 0, speedSq: 0, refAltitude: null, refIas: null, refCourse: null },
            formationS: 0,
            fuelAtStartKg: totalFuel(this.sim.aircraft),
            missedChecklistItems: 0,
            threatReportDelays: [],
            fighterFirstSeenTick: {},
            fighterReported: {},
            kills: {},
            damagedFighters: {},
            flakBurstsNear: 0,
            timeOverTargetS: null,
            ipTick: null,
        };

        this.phase = start.phase ?? 'preflight';

        if (this.difficulty === 'training') {
            // «Учебный» режим: рутина автоматизирована — прицел и счисление знают точные вводные.
            this.sight.autoRelease = true;
        }

        this.rebuildAi();
    }

    // ───────────────────────────── доступ ─────────────────────────────

    get tick(): number {
        return this.sim.tick;
    }

    get timeS(): number {
        return this.sim.timeS;
    }

    get aircraft(): AircraftState {
        return this.sim.aircraft;
    }

    derived(): AircraftDerived {
        return this.sim.derived();
    }

    member(station: Station) {
        return this.crew.members[station];
    }

    isHuman(station: Station): boolean {
        return this.humans.includes(station);
    }

    /** Станцию ведёт ИИ: место не занято игроком и член экипажа в строю. */
    aiControls(station: Station): boolean {
        return !this.isHuman(station) && isActive(this.member(station));
    }

    knownTarget(): TargetRuntime {
        if (this.knownTargetId === this.target.def.id) {
            return this.target;
        }

        return this.alternateTargets.find((t) => t.def.id === this.knownTargetId) ?? this.target;
    }

    waypoint(type: WaypointType): WaypointRuntime | undefined {
        return this.waypoints.find((w) => w.type === type);
    }

    /** Позиция путевой точки с учётом цели, известной экипажу. */
    waypointPosition(index: number): Vec3 | null {
        const w = this.waypoints[index];

        if (w === undefined) {
            return null;
        }

        if (w.type === 'target') {
            const t = this.knownTarget();

            return { ...t.aim, z: w.position.z };
        }

        return w.position;
    }

    ballisticTable(): BallisticTable | null {
        const next = this.rack[0];

        return next !== undefined ? (this.tables.get(next) ?? null) : (this.tables.values().next().value ?? null);
    }

    event(type: string, payload: Record<string, unknown> = {}): void {
        this.events.push({ tick: this.tick, type, payload });
    }

    say(from: Station | 'tower' | 'base' | 'system', key: string, params: Record<string, string | number> = {}): void {
        say(this.crew, this.tick, from, key, params);
    }

    // ───────────────────────────── игроки и ИИ ─────────────────────────────

    setHumans(stations: Station[]): void {
        this.humans = [...stations];

        for (const station of STATIONS) {
            this.crew.members[station].controller = this.humans.includes(station) ? 'human' : 'ai';
        }

        this.rebuildAi();
    }

    /** ИИ для свободных мест; уже работающий ИИ сохраняет своё состояние при переходах игрока. */
    rebuildAi(): void {
        if (this.aiFactory === null) {
            this.ai = {};

            return;
        }

        for (const station of STATIONS) {
            const wanted = !this.isHuman(station) && !this.aiDisabled.includes(station);

            if (!wanted) {
                delete this.ai[station];
            } else if (this.ai[station] === undefined) {
                const ai = this.aiFactory(station, this);

                if (ai !== null) {
                    this.ai[station] = ai;
                }
            }
        }
    }

    // ───────────────────────────── действия станций ─────────────────────────────

    damageContext(): DamageContext {
        return {
            config: this.config,
            aircraft: this.sim.aircraft,
            crew: this.crew,
            rng: this.rng,
            tick: this.tick,
            event: (type, payload) => this.event(type, payload),
        };
    }

    /** Дискретное действие станции (игрок или ИИ — одни и те же команды, раздел 8.4). */
    act(station: Station, action: WorldAction): void {
        const member = this.member(station);

        if (!isActive(member) && action.type !== 'jump') {
            return;
        }

        const a = this.sim.aircraft;

        switch (action.type) {
            case 'gear':
                // Пилот отдаёт приказ второму пилоту; без второго пилота делает сам.
                if (station === 'pilot' && isActive(this.member('copilot'))) {
                    if (this.orders.gearDown !== action.down) {
                        this.say('pilot', action.down ? 'intercom.order_gear_down' : 'intercom.order_gear_up');
                    }

                    this.orders = { ...this.orders, gearDown: action.down, issuedTick: this.tick };
                } else {
                    this.copilot.gearDown = action.down;
                }
                break;
            case 'flaps':
                if (station === 'pilot' && isActive(this.member('copilot'))) {
                    if (this.orders.flaps !== action.value) {
                        this.say('pilot', 'intercom.order_flaps', { percent: Math.round(action.value * 100) });
                    }

                    this.orders = { ...this.orders, flaps: action.value, issuedTick: this.tick };
                } else {
                    this.copilot.flaps = clamp(action.value, 0, 1);
                }
                break;
            case 'engine': {
                const field = this.copilot[action.field];

                if (typeof action.value === 'boolean') {
                    (field as boolean[])[action.index] = action.value;
                } else {
                    (field as number[])[action.index] = clamp(action.value, 0, 1);
                }
                break;
            }
            case 'battery':
                this.copilot.battery = action.on;
                break;
            case 'fuel_pump':
                this.copilot.fuelPump = action.on;
                break;
            case 'extinguish':
                extinguishEngine(this.damageContext(), this.damage, action.index);
                break;
            case 'take_control':
                if (station === 'copilot') {
                    this.crew.takeControlRequestedTick = this.tick;
                    this.say('copilot', 'intercom.take_control');

                    if (!isActive(this.member('pilot'))) {
                        this.handOver();
                    }
                }
                break;
            case 'confirm_handover':
                if (station === 'pilot' && this.crew.takeControlRequestedTick !== null) {
                    this.handOver();
                }
                break;
            case 'checklist':
                checkItem(this.checklists, action.list, action.item, a, { oxygenOn: this.crew.oxygenOn });
                break;
            case 'oxygen':
                this.crew.oxygenOn = action.on;
                break;
            case 'sight_on':
                if (!failed(this.damage, 'bombsight')) {
                    activateSight(this.sight, this.derived().heading, Math.max(this.releaseRangeEstimate() + 6000, 8000));
                }
                break;
            case 'sight_adjust':
                if (action.rate !== undefined) {
                    this.sight.rateMs = clamp(this.sight.rateMs + action.rate, 30, 200);
                }

                if (action.drift !== undefined) {
                    this.sight.driftRad = clamp(this.sight.driftRad + action.drift, -0.5, 0.5);
                }

                if (action.along !== undefined || action.across !== undefined) {
                    nudgeCrosshair(this.sight, this.derived().heading, action.along ?? 0, action.across ?? 0);
                }
                break;
            case 'sight_set':
                if (action.altitudeM !== undefined) {
                    this.sight.altitudeSetM = clamp(action.altitudeM, 300, 9000);
                }

                if (action.tasMs !== undefined) {
                    this.sight.tasSetMs = clamp(action.tasMs, 50, 200);
                }
                break;
            case 'doors':
                this.doorsCommand = action.open;
                this.event('bay_doors', { open: action.open });
                break;
            case 'arm':
                this.sight.armed = action.on;
                break;
            case 'release_mode':
                this.sight.mode = action.mode;

                if (action.intervalMs !== undefined) {
                    this.sight.intervalMs = clamp(action.intervalMs, 30, 1000);
                }
                break;
            case 'auto_release':
                this.sight.autoRelease = action.on;
                break;
            case 'release':
                this.startRelease(false);
                break;
            case 'salvo':
                this.startRelease(true);
                break;
            case 'nav_drift': {
                const d = this.derived();

                this.nav.windEst = solveWind(d.heading, d.trueAirspeed, action.driftRad, action.groundSpeedMs);
                this.nav.lastDriftMeasureTick = this.tick;
                break;
            }
            case 'nav_fix': {
                const landmark = this.landmarks.find((l) => l.id === action.landmark);

                if (landmark && distance2(landmark.position, a.position) < this.visualRange()) {
                    const sigma = 250 + 0.05 * distance2(landmark.position, a.position);

                    applyFix(this.nav, a.position, this.rng, sigma / Math.max(member.efficiency, 0.3), this.tick);
                    this.event('nav_fix', { landmark: landmark.id });
                }
                break;
            }
            case 'nav_leg':
                this.nav.legIndex = clamp(Math.round(action.index), 1, this.waypoints.length - 1);
                break;
            case 'radio_dial':
                this.radio.dialMhz = action.mhz;
                break;
            case 'decode': {
                const message = this.radio.received.find((r) => r.messageId === action.messageId);

                if (message && message.decoded === null) {
                    decode(message, action.meaning, this.mission.radio.code_table, this.tick);
                    this.applyMessage(message);
                }
                break;
            }
            case 'iff':
                this.radio.iff = action.on;
                break;
            case 'distress':
                if (!this.radio.failed && !failed(this.damage, 'radio')) {
                    this.radio.distressSent = true;
                    this.radio.exposure++;
                    this.event('distress', { x: this.nav.dr.x, y: this.nav.dr.y });
                    this.say('radio', 'intercom.distress_sent');
                }
                break;
            case 'task':
                this.startTask(station, action.kind, action.target ?? null);
                break;
            case 'intercom':
                this.say(station, action.key, action.params ?? {});
                break;
            case 'report_threat':
                this.reportThreat(station, action.clock, action.level, action.kind ?? 'fighter');
                break;
            case 'order':
                this.order(station, action.order);
                break;
            case 'jump':
                if (this.crew.bailOutOrdered && !member.bailedOut && this.sim.aircraft.contact === 'air') {
                    member.bailedOut = true;
                    this.event('bailed_out', { station });
                }
                break;
        }
    }

    private handOver(): void {
        this.crew.flyingStation = 'copilot';
        this.crew.takeControlRequestedTick = null;
        this.copilotFlight = { ...this.pilot };
        this.say('copilot', 'intercom.have_control');
        this.event('control_handover', {});
    }

    private order(station: Station, order: 'report_ready' | 'stations' | 'prepare_bailout' | 'bailout' | 'cancel_bailout'): void {
        if (station !== this.crew.flyingStation && station !== 'pilot') {
            return;
        }

        this.event('order', { order });

        switch (order) {
            case 'report_ready':
                this.say(station, 'intercom.order_report');

                for (const s of STATIONS) {
                    if (s !== station && this.aiControls(s)) {
                        this.say(s, 'intercom.ready', { station: s });
                    }
                }
                break;
            case 'stations':
                this.say(station, 'intercom.order_stations');
                break;
            case 'prepare_bailout':
                this.crew.prepareBailOut = true;
                this.say(station, 'intercom.order_prepare_bailout');
                break;
            case 'bailout':
                this.crew.bailOutOrdered = true;
                this.say(station, 'intercom.order_bailout');

                for (const s of STATIONS) {
                    const m = this.member(s);

                    if (!this.isHuman(s) && isActive(m)) {
                        m.bailOutAtTick = this.tick + Math.round(this.rng.range(2, 5) * TICK_HZ);
                    }
                }
                break;
            case 'cancel_bailout':
                this.crew.prepareBailOut = false;
                this.crew.bailOutOrdered = false;
                break;
        }
    }

    private startTask(station: Station, kind: 'extinguish' | 'first_aid' | 'emergency_gear' | 'fuel_transfer', target: string | null): void {
        const member = this.member(station);
        const model = this.config.damage_model.value;

        if (!isAvailable(member)) {
            return;
        }

        // Бортинженер (верхняя турель) — пожары, перекачка, аварийный выпуск; бортовой стрелок — первая помощь.
        const allowed = station === 'top_gunner' ? kind !== 'first_aid' : station === 'waist_gunner' ? kind === 'first_aid' : false;

        if (!allowed) {
            return;
        }

        const duration = { extinguish: model.extinguish_s, first_aid: model.first_aid_s, emergency_gear: model.emergency_gear_s, fuel_transfer: 20 }[kind];

        member.task = { kind, remainingS: duration / Math.max(member.efficiency, 0.3), target };
        this.event('task', { station, kind, target });
    }

    private reportThreat(station: Station, clock: number, level: 'high' | 'level' | 'low', kind: 'fighter' | 'flak'): void {
        addThreat(this.crew, { clock, level, kind, reportedBy: station }, this.tick, THREAT_TTL_S * TICK_HZ);
        this.say(station, kind === 'fighter' ? 'intercom.fighter_report' : 'intercom.flak_report', { clock, level });

        // Время доклада: от появления ближайшего неучтённого истребителя.
        for (const f of this.fighters) {
            const seen = this.metrics.fighterFirstSeenTick[f.id];

            if (seen !== undefined && this.metrics.fighterReported[f.id] !== true) {
                this.metrics.fighterReported[f.id] = true;
                this.metrics.threatReportDelays.push((this.tick - seen) / TICK_HZ);
            }
        }
    }

    /** Применение расшифрованного сообщения к знаниям экипажа (раздел 6.5). */
    private applyMessage(message: ReceivedMessage): void {
        if (message.applied || message.decoded === null) {
            return;
        }

        message.applied = true;
        this.event('message_decoded', { id: message.messageId, meaning: message.decoded, correct: message.correct });

        switch (message.decoded) {
            case 'recall':
                if (message.correct === true) {
                    this.recallKnown = true;
                    this.say('radio', 'intercom.recall');
                }
                break;
            case 'change_target':
                if (message.correct === true && this.knownTargetId !== this.target.def.id) {
                    this.knownTargetId = this.target.def.id;
                    this.say('radio', 'intercom.target_changed');
                }
                break;
            default:
                this.say('radio', `radio_meaning.${message.decoded}`);
                break;
        }
    }

    // ───────────────────────────── бомбометание ─────────────────────────────

    private releaseRangeEstimate(): number {
        const table = this.ballisticTable();

        if (table === null) {
            return 4000;
        }

        const d = this.derived();
        const target = this.knownTarget();

        return Math.max(1000, d.trueAirspeed * Math.sqrt((2 * Math.max(d.altitude - target.aim.z, 300)) / 9.81) * 0.95);
    }

    trainSpreadM(): number {
        const n = this.sight.mode === 'salvo' ? 1 : this.rack.length;

        return ((n - 1) / 2) * (this.sight.intervalMs / 1000) * this.sight.rateMs;
    }

    sightReadout(): SightReadout | null {
        const table = this.ballisticTable();

        if (table === null) {
            return null;
        }

        const a = this.sim.aircraft;
        const target = this.knownTarget();

        return readSight(this.sight, table, this.derived().heading, { x: target.aim.x - a.position.x, y: target.aim.y - a.position.y }, this.trainSpreadM());
    }

    /** Начать сброс: серия по интервалометру или залп; аварийный — без взведения, люк не нужен. */
    startRelease(emergency: boolean): void {
        if (this.rack.length === 0 || this.releaseQueue.length > 0) {
            return;
        }

        const doorsOpen = this.sim.aircraft.bayDoors > 0.95;

        if (!emergency && !doorsOpen) {
            this.say('bombardier', 'intercom.doors_closed');

            return;
        }

        const interval = emergency || this.sight.mode === 'salvo' ? 0 : Math.max(1, Math.round((this.sight.intervalMs / 1000) * TICK_HZ));
        const armed = this.sight.armed && !emergency;

        this.rack.forEach((typeId, i) => {
            this.releaseQueue.push({ typeId, tick: this.tick + i * (interval || 0), armed });
        });
        this.rack = [];
        this.event('bombs_released', { emergency, count: this.releaseQueue.length, armed });
        this.say('bombardier', emergency ? 'intercom.salvo' : 'intercom.bombs_away');

        if (this.metrics.timeOverTargetS === null && !emergency) {
            this.metrics.timeOverTargetS = this.timeS;
        }
    }

    private stepBombing(dt: number): void {
        const a = this.sim.aircraft;
        const d = this.derived();
        const table = this.ballisticTable();

        this.sight.failed = failed(this.damage, 'bombsight');
        stepBombsight(this.sight, d.heading, dt);

        if (table !== null && this.rack.length > 0 && !this.sight.releasing && shouldRelease(this.sight, table, d.heading, this.trainSpreadM())) {
            this.sight.releasing = true;
            this.startRelease(false);
        }

        // Выпуск бомб из очереди интервалометра.
        while (this.releaseQueue.length > 0 && (this.releaseQueue[0]?.tick ?? Infinity) <= this.tick) {
            const item = this.releaseQueue.shift();

            if (item === undefined) {
                break;
            }

            const type = bombType(this.content, item.typeId);
            const bayX = this.config.bomb_bay.gameplay_x_m.value;
            const target = this.knownTarget();

            this.bombs.push({
                id: this.nextId++,
                typeId: item.typeId,
                position: add(a.position, rotate(a.attitude, vec(bayX, 0, 1.2))),
                velocity: { ...a.velocity },
                armed: item.armed,
                releasedTick: this.tick,
                aimPoint: { ...target.aim },
            });
            this.sim.patchAircraft({ loadout: { ...this.sim.aircraft.loadout, bombsKg: Math.max(0, this.sim.aircraft.loadout.bombsKg - type.mass_kg.value) } });
        }

        // Падение бомб.
        for (const bomb of this.bombs) {
            const type = bombType(this.content, bomb.typeId);

            stepBomb(bomb, type, this.weather, dt);

            const ground = this.terrain.heightAt(bomb.position.x, bomb.position.y);

            if (bomb.position.z <= ground) {
                this.bombImpact(bomb, { ...bomb.position, z: ground });
            }
        }

        this.bombs = this.bombs.filter((b) => b.position.z > this.terrain.heightAt(b.position.x, b.position.y));
    }

    private bombImpact(bomb: FallingBomb, at: Vec3): void {
        const type = bombType(this.content, bomb.typeId).gameplay.value;
        const miss = distance2(at, bomb.aimPoint);
        let onTarget = false;

        if (bomb.armed) {
            for (const target of [this.target, ...this.alternateTargets]) {
                for (const section of target.sections) {
                    const local = this.toTargetFrame(target, at);
                    const sl = this.toTargetFrame(target, section.center);
                    const dx = Math.max(Math.abs(local.along - sl.along) - section.halfLength, 0);
                    const dy = Math.max(Math.abs(local.across - sl.across) - section.halfWidth, 0);
                    const dist = Math.hypot(dx, dy);
                    let dmg = 0;

                    if (dist <= type.lethal_radius_m) {
                        dmg = type.damage;
                    } else if (dist <= type.damage_radius_m) {
                        dmg = type.damage * 0.5 * (1 - (dist - type.lethal_radius_m) / (type.damage_radius_m - type.lethal_radius_m));
                    }

                    if (dmg > 0) {
                        section.damage += dmg;
                        onTarget = onTarget || target === this.target;
                    }
                }
            }
        }

        this.impacts.push({ bombId: bomb.id, typeId: bomb.typeId, position: at, missM: miss, armed: bomb.armed, tick: this.tick, onTarget });
        this.event('bomb_impact', { id: bomb.id, miss_m: Math.round(miss), armed: bomb.armed, x: Math.round(at.x), y: Math.round(at.y) });
    }

    private toTargetFrame(target: TargetRuntime, p: { x: number; y: number }): { along: number; across: number } {
        const dx = p.x - target.aim.x;
        const dy = p.y - target.aim.y;

        return { along: dx * Math.sin(target.heading) + dy * Math.cos(target.heading), across: dx * Math.cos(target.heading) - dy * Math.sin(target.heading) };
    }

    private buildTarget(def: MissionTarget): TargetRuntime {
        const aim = toEnu(this.theatre, def.aim_point.lat, def.aim_point.lon, def.elevation_m);
        const heading = (def.heading_deg * Math.PI) / 180;

        return {
            def,
            aim,
            heading,
            sections: def.sections.map((s) => ({
                id: s.id,
                center: vec(
                    aim.x + Math.sin(heading) * s.offset_m[0] + Math.cos(heading) * s.offset_m[1],
                    aim.y + Math.cos(heading) * s.offset_m[0] - Math.sin(heading) * s.offset_m[1],
                    def.elevation_m,
                ),
                halfLength: s.length_m / 2,
                halfWidth: s.width_m / 2,
                strength: s.strength,
                damage: 0,
            })),
        };
    }

    targetResult(target: TargetRuntime = this.target): { status: 'destroyed' | 'damaged' | 'intact'; percent: number } {
        const shares = target.sections.map((s) => Math.min(1, s.damage / s.strength));
        const percent = Math.round((shares.reduce((a, b) => a + b, 0) / Math.max(shares.length, 1)) * 100);
        const destroyedCount = shares.filter((s) => s >= 1).length;
        const destroyed = target.def.destroyed_when === 'any_section' ? destroyedCount > 0 : destroyedCount === shares.length;

        return { status: destroyed ? 'destroyed' : percent > 0 ? 'damaged' : 'intact', percent };
    }

    // ───────────────────────────── оружие и противник ─────────────────────────────

    private spawnBullet = (b: Omit<Bullet, 'id'>): void => {
        if (this.bullets.length < MAX_BULLETS) {
            this.bullets.push({ ...b, id: this.nextId++ });
        }
    };

    private stepGuns(dt: number): void {
        const a = this.sim.aircraft;
        const mounts = this.config.gameplay_mounts.value;

        for (const mount of this.mounts) {
            const cfg = mounts[mount.id];

            if (cfg === undefined) {
                continue;
            }

            mount.disabled =
                (mount.station === 'top_gunner' && failed(this.damage, 'turret')) ||
                (mount.id === 'nose_flex' && failed(this.damage, 'nose_gun')) ||
                ((mount.id === 'waist_left' || mount.id === 'waist_right') && failed(this.damage, 'waist_guns')) ||
                (mount.id === 'tail' && failed(this.damage, 'tail_gun'));

            const operator = this.member(mount.station);
            let command: MountCommand = this.mountCommands[mount.id] ?? { fire: false, clearJam: false };

            if (mount.fixed) {
                command = { fire: this.pilot.fireFixed && isActive(this.member('pilot')), clearJam: false };
            } else if (!isAvailable(operator)) {
                command = { fire: false, clearJam: false };
            }

            stepMount(mount, cfg, command, this.content.gun, a, this.rng, dt, this.spawnBullet, operator.efficiency);
        }
    }

    private stepBullets(dt: number): void {
        const a = this.sim.aircraft;
        const drag = this.content.gun.gameplay.value.drag_k_per_m;
        const lifetime = this.content.gun.gameplay.value.lifetime_s;

        for (const bullet of this.bullets) {
            const { from, to } = stepBullet(bullet, drag, dt);

            if (bullet.owner === 'bomber') {
                for (const f of this.fighters) {
                    if (f.phase === 'down' || f.removed) {
                        continue;
                    }

                    const type = fighterType(this.content, f.typeId);
                    const prev = sub(f.position, scale(f.velocity, dt));

                    if (segmentSphere(sub(from, prev), sub(to, f.position), vec(), type.radius_m) !== null) {
                        this.hitFighter(f, bullet);
                        bullet.ageS = Infinity;
                        break;
                    }
                }
            } else if (!this.aircraftLost) {
                const relFrom = sub(from, this.prevBomberPosition);
                const relTo = sub(to, a.position);

                if (segmentSphere(relFrom, relTo, vec(), BOMBER_RADIUS_M) !== null) {
                    const dirWorld = sub(relTo, relFrom);
                    const len = length(dirWorld);
                    const originBody = rotateInverse(a.attitude, relFrom);
                    const dirBody = rotateInverse(a.attitude, scale(dirWorld, 1 / Math.max(len, 1e-6)));
                    const zone = raycastZones(this.config, originBody, dirBody, len + 1);

                    if (zone !== null) {
                        applyHit(this.damageContext(), this.damage, zone, bullet.damage, 'bullet');
                        bullet.ageS = Infinity;
                    }
                }
            }
        }

        this.bullets = this.bullets.filter((b) => b.ageS < lifetime && b.position.z > this.terrain.heightAt(b.position.x, b.position.y));
    }

    private hitFighter(f: Fighter, bullet: Bullet): void {
        const type = fighterType(this.content, f.typeId);
        const wasHealthy = f.hp >= type.hp;

        f.hp -= bullet.damage;
        f.lastHitBy = bullet.mount;

        const mount = this.mounts.find((m) => m.id === bullet.mount);

        if (mount) {
            mount.hits++;

            if (wasHealthy) {
                this.metrics.damagedFighters[mount.station] = (this.metrics.damagedFighters[mount.station] ?? 0) + 1;
            }
        }

        if (f.hp <= 0 && f.phase !== 'down') {
            f.phase = 'down';

            if (mount) {
                this.metrics.kills[mount.station] = (this.metrics.kills[mount.station] ?? 0) + 1;
                this.say(mount.station, 'intercom.fighter_down');
            }

            this.event('fighter_down', { id: f.id, by: bullet.mount });
        }
    }

    spawnWave(waveId: string): void {
        const wave = this.mission.threats.fighter_waves.find((w) => w.id === waveId);

        if (wave === undefined) {
            return;
        }

        const a = this.sim.aircraft;
        const type = fighterType(this.content, wave.type);
        const heading = this.derived().heading;
        const b = heading + (wave.spawn.bearing_deg * Math.PI) / 180;

        for (let i = 0; i < wave.count; i++) {
            const offset = vec(Math.sin(b) * wave.spawn.distance_m + i * 120, Math.cos(b) * wave.spawn.distance_m - i * 80, wave.spawn.altitude_offset_m + i * 40);
            const position = add(a.position, offset);
            const toward = normalize(sub(a.position, position));
            const fighter = createFighter(this.nextId++, type, wave.id, wave.skill, position, scale(toward, type.cruise_speed_ms), wave.attacks, i % 2 === 0 ? 1 : -1);

            fighter.attackIndex = i;
            this.fighters.push(fighter);
        }

        this.event('wave_spawned', { wave: wave.id, count: wave.count });
    }

    private inCloud(z: number): boolean {
        return this.mission.weather.clouds.some((c) => z >= c.base_m && z <= c.top_m && c.coverage > 0.5);
    }

    visualRange(): number {
        return Math.min(this.mission.weather.visibility_m, 25000);
    }

    private stepFighters(dt: number): void {
        const a = this.sim.aircraft;
        const target = { position: a.position, velocity: a.velocity, inCloud: this.inCloud(a.position.z) };

        for (const f of this.fighters) {
            stepFighter(f, {
                config: this.content.fighters,
                type: fighterType(this.content, f.typeId),
                target,
                groundAt: (x, y) => this.terrain.heightAt(x, y),
                rng: this.rng,
                dt,
                spawnBullet: this.spawnBullet,
            });

            if (this.metrics.fighterFirstSeenTick[f.id] === undefined && distance2(f.position, a.position) < 4000 && f.phase !== 'down') {
                this.metrics.fighterFirstSeenTick[f.id] = this.tick;
            }
        }

        this.fighters = this.fighters.filter((f) => !f.removed);
    }

    private stepFlak(dt: number): void {
        const a = this.sim.aircraft;
        const d = this.derived();
        const target = { position: a.position, velocity: a.velocity, heading: d.heading };
        const barrageCenter = this.phase === 'bomb_run' ? this.target.aim : null;

        for (const battery of this.batteries) {
            const type = flakType(this.content, battery.typeId);
            const bursts = stepBattery(battery, type, target, barrageCenter, this.rng, this.tick, TICK_HZ, dt, () => this.nextId++);

            if (bursts.length > 0) {
                this.lastFlakTick = this.tick;
            }

            this.bursts.push(...bursts);
        }

        for (const burst of this.bursts) {
            if (burst.resolved || burst.tick > this.tick) {
                continue;
            }

            burst.resolved = true;

            if (this.aircraftLost) {
                continue;
            }

            const type = flakType(this.content, burst.typeId);
            const rel = sub(a.position, burst.position);
            const dist = length(rel);
            const n = poisson(this.rng, expectedFragments(type, dist));

            if (dist < 150) {
                this.metrics.flakBurstsNear++;
            }

            if (n > 0) {
                const dirBody = rotateInverse(a.attitude, normalize(rel));
                const weights = zoneWeights(this.config, dirBody);

                for (let i = 0; i < n; i++) {
                    const zone = pickWeighted(weights, this.rng)?.zone;

                    if (zone !== undefined) {
                        applyHit(this.damageContext(), this.damage, zone, type.damage_per_fragment, 'flak');
                    }
                }
            }
        }

        const keepTicks = BURST_VISIBLE_S * TICK_HZ;

        this.bursts = this.bursts.filter((b) => !b.resolved || this.tick - b.tick < keepTicks);
    }

    private stepWingmen(dt: number): void {
        const a = this.sim.aircraft;
        const heading = this.derived().heading;
        const fwd = vec(Math.sin(heading), Math.cos(heading), 0);
        const right = vec(Math.cos(heading), -Math.sin(heading), 0);

        for (const w of this.wingmen) {
            const slot = add(add(add(a.position, scale(fwd, w.slot.x)), scale(right, w.slot.y)), vec(0, 0, w.slot.z));
            const error = sub(slot, w.position);
            const desired = add(a.velocity, scale(error, 0.08));
            const speed = length(desired);
            const capped = speed > 140 ? scale(desired, 140 / speed) : desired;

            w.velocity = add(w.velocity, scale(sub(capped, w.velocity), Math.min(1, 0.6 * dt)));
            w.position = add(w.position, scale(w.velocity, dt));
            w.joined = length(error) < 60;
        }

        if (this.wingmen.length > 0 && this.wingmen.every((w) => w.joined)) {
            this.metrics.formationS += dt;
        }
    }

    private spawnWingmen(): void {
        const a = this.sim.aircraft;
        const n = this.mission.formation.wingmen;
        const s = this.mission.formation.spacing_m;

        for (let i = 0; i < n; i++) {
            const row = Math.floor(i / 2) + 1;
            const sideSign = i % 2 === 0 ? -1 : 1;
            const slot = vec(-s * row, sideSign * s * row, 12 * row);

            this.wingmen.push({ id: this.nextId++, slot, position: add(a.position, vec(sideSign * 600, -900 - 200 * i, -60)), velocity: { ...a.velocity }, joined: false });
        }

        this.event('formation_joined', { wingmen: n });
    }

    // ───────────────────────────── фазы и триггеры ─────────────────────────────

    setPhase(phase: Phase): void {
        if (phase === this.phase) {
            return;
        }

        // Пропущенные пункты чек-листов уходящей фазы.
        for (const [list, owner] of Object.entries(CHECKLIST_PHASE) as [ChecklistId, string][]) {
            if (owner === this.phase) {
                this.metrics.missedChecklistItems += missedItems(this.checklists, list);
            }
        }

        this.event('phase', { from: this.phase, to: phase });
        this.phase = phase;
        this.phaseStartTick = this.tick;
        this.say('system', `phase.${phase}`);
    }

    private stepPhase(): void {
        const a = this.sim.aircraft;
        const d = this.derived();
        const ground = a.contact !== 'air';
        const groundSpeed = Math.hypot(a.velocity.x, a.velocity.y);

        if (this.phase === 'debrief') {
            return;
        }

        // Потеря самолёта → разбор.
        if (a.contact === 'crashed') {
            this.finish('crashed');

            return;
        }

        const aboard = STATIONS.filter((s) => !this.member(s).bailedOut);

        if (aboard.length === 0) {
            this.finish('bailed_out');

            return;
        }

        if (this.recallKnown && ['formup', 'route', 'bomb_run'].includes(this.phase)) {
            this.setPhase('return');
        }

        const near = (type: WaypointType, radius: number): boolean => {
            const w = this.waypoint(type);

            return w !== undefined && distance2(w.position, a.position) < radius;
        };

        switch (this.phase) {
            case 'preflight':
                if (ground && groundSpeed > 3) {
                    this.setPhase('takeoff');
                }
                break;
            case 'takeoff':
                if (!ground && d.agl > 150) {
                    this.setPhase('formup');
                }
                break;
            case 'formup': {
                if (this.wingmen.length === 0 && this.mission.formation.wingmen > 0 && near('formup', 4000)) {
                    this.spawnWingmen();
                }

                const formed = this.mission.formation.wingmen === 0 ? near('formup', 3000) : this.wingmen.length > 0 && (this.wingmen.every((w) => w.joined) || this.tick - this.phaseStartTick > 240 * TICK_HZ);

                if (formed || this.nav.legIndex > this.waypoints.findIndex((w) => w.type === 'formup')) {
                    this.setPhase('route');
                }
                break;
            }
            case 'route': {
                const ip = this.waypoint('ip');

                if (ip !== undefined && (near('ip', 3000) || this.nav.legIndex > this.waypoints.indexOf(ip))) {
                    this.metrics.ipTick = this.tick;
                    this.nav.errorAtIpM = distance2(this.nav.dr, a.position);
                    this.setPhase('bomb_run');
                }
                break;
            }
            case 'bomb_run': {
                const t = this.knownTarget();
                const toTarget = vec(t.aim.x - a.position.x, t.aim.y - a.position.y, 0);
                const along = toTarget.x * Math.sin(d.heading) + toTarget.y * Math.cos(d.heading);
                const released = this.rack.length === 0 && this.releaseQueue.length === 0;

                if ((released && this.bombs.length === 0) || along < -4000) {
                    this.setPhase('egress');
                }
                break;
            }
            case 'egress':
                if (near('rally', 4000) || this.tick - this.phaseStartTick > 420 * TICK_HZ) {
                    this.setPhase('return');
                }
                break;
            case 'return': {
                const base = distance2(a.position, this.runway);

                if (base < 16000 || near('initial_approach', 3000)) {
                    this.setPhase('landing');
                    this.wingmen = [];
                }
                break;
            }
            case 'landing':
                if (ground && groundSpeed < 1) {
                    this.finish(this.landingOutcome());
                } else if (a.contact === 'water' && groundSpeed < 3) {
                    this.finish('ditched');
                }
                break;
        }

        // Посадка на воду или вынужденная посадка на любой фазе.
        if (this.phase !== 'preflight' && this.phase !== 'takeoff' && this.phase !== 'landing' && ground && groundSpeed < 2) {
            this.finish(a.contact === 'water' ? 'ditched' : this.landingOutcome());
        }
    }

    landingOutcome(): Outcome {
        const a = this.sim.aircraft;
        const r = this.runway;
        const dx = a.position.x - r.x;
        const dy = a.position.y - r.y;
        const along = dx * Math.sin(r.heading) + dy * Math.cos(r.heading);
        const across = dx * Math.cos(r.heading) - dy * Math.sin(r.heading);
        const onField = Math.abs(along) < r.length_m / 2 + 300 && Math.abs(across) < r.width_m / 2 + 60;

        if (a.contact === 'water') {
            return 'ditched';
        }

        if (a.contact === 'belly') {
            return 'belly_landed';
        }

        return onField ? 'landed' : 'landed_off_field';
    }

    private finish(outcome: Outcome): void {
        if (this.phase === 'debrief') {
            return;
        }

        this.outcome = outcome;
        this.event('outcome', { outcome });
        this.setPhase('debrief');
    }

    private conditionMet(when: MissionDefinition['triggers'][number]['when']): boolean {
        if (when.phase !== undefined && when.phase !== this.phase) {
            return false;
        }

        if (when.time_s !== undefined && this.timeS < when.time_s) {
            return false;
        }

        if (when.near_waypoint !== undefined) {
            const w = this.waypoints.find((p) => p.id === when.near_waypoint?.id);

            if (w === undefined || distance2(w.position, this.sim.aircraft.position) > when.near_waypoint.radius_m) {
                return false;
            }
        }

        if (when.event !== undefined) {
            const has = (type: string): boolean => this.events.some((e) => e.type === type);

            switch (when.event) {
                case 'bombs_released':
                    if (!has('bombs_released')) {
                        return false;
                    }
                    break;
                case 'radio_transmit':
                    if (this.radio.exposure === 0) {
                        return false;
                    }
                    break;
                case 'message_received':
                    if (!this.radio.received.some((r) => when.message_id === undefined || r.messageId === when.message_id)) {
                        return false;
                    }
                    break;
                case 'aircraft_damaged':
                    if (this.damage.lastHitTick === null) {
                        return false;
                    }
                    break;
            }
        }

        return true;
    }

    private stepTriggers(): void {
        for (const trigger of this.mission.triggers) {
            if (trigger.once && this.triggersFired.has(trigger.id)) {
                continue;
            }

            if (!this.conditionMet(trigger.when)) {
                continue;
            }

            this.triggersFired.add(trigger.id);

            // Вероятность проверяется один раз; передачи в эфир повышают шанс перехвата.
            if (trigger.when.probability !== undefined) {
                const p = clamp(trigger.when.probability * (1 + 0.5 * this.radio.exposure), 0, 1);

                if (!this.rng.chance(p)) {
                    this.event('trigger_skipped', { id: trigger.id });
                    continue;
                }
            }

            this.event('trigger', { id: trigger.id });

            for (const action of trigger.then) {
                this.runAction(action);
            }
        }
    }

    runAction(action: MissionAction): void {
        switch (action.type) {
            case 'spawn_wave':
                this.spawnWave(action.wave);
                break;
            case 'send_radio': {
                const def = this.mission.radio_script.find((m) => m.id === action.message);

                if (def) {
                    transmit(this.radio, def, this.mission.radio.frequencies_mhz[def.channel], this.tick, TICK_HZ);
                    this.event('radio_sent', { id: def.id });
                }
                break;
            }
            case 'change_target': {
                const next = this.alternateTargets.find((t) => t.def.id === action.target);

                if (next) {
                    this.alternateTargets = [this.target, ...this.alternateTargets.filter((t) => t !== next)];
                    this.target = next;
                    this.event('target_changed', { target: next.def.id });
                }
                break;
            }
            case 'set_weather':
                if (action.weather.wind !== undefined) {
                    this.weather.wind = action.weather.wind;
                }
                break;
            case 'activate_battery': {
                const battery = this.batteries.find((b) => b.id === action.battery);

                if (battery) {
                    battery.active = true;
                }
                break;
            }
            case 'recall':
                this.event('recall_issued', {});
                break;
        }
    }

    // ───────────────────────────── экипаж ─────────────────────────────

    private stepCrew(dt: number): void {
        const model = this.config.damage_model.value;
        const ctx = this.damageContext();
        const altitude = this.sim.aircraft.position.z;
        const threshold = this.config.systems.gameplay_oxygen_threshold_m.value;

        expireThreats(this.crew, this.tick);

        for (const station of STATIONS) {
            const m = this.member(station);

            // Прыжок ИИ с задержкой после команды.
            if (m.bailOutAtTick !== null && this.tick >= m.bailOutAtTick && !m.bailedOut && this.sim.aircraft.contact === 'air') {
                m.bailedOut = true;
                this.event('bailed_out', { station });
            }

            if (!isActive(m)) {
                continue;
            }

            // Гипоксия выше порога без кислорода.
            const maxEfficiency = m.health === 'wounded' ? (m.treated ? 0.8 : 0.55) : 1;

            if (altitude > threshold && !this.crew.oxygenOn) {
                m.efficiency = Math.max(0.2, m.efficiency - this.config.systems.gameplay_hypoxia_rate_per_s.value * dt);
            } else {
                m.efficiency = Math.min(maxEfficiency, m.efficiency + 0.01 * dt);
            }

            // Выполнение задач.
            const task = m.task;

            if (task !== null) {
                task.remainingS -= dt;

                if (task.remainingS <= 0) {
                    m.task = null;

                    switch (task.kind) {
                        case 'extinguish':
                            extinguishFuselage(ctx, this.damage);

                            for (const i of [0, 1] as const) {
                                if (this.damage.wingFireS[i] !== null && this.rng.chance(0.25)) {
                                    this.damage.wingFireS[i] = null;
                                }
                            }
                            break;
                        case 'first_aid':
                            if (task.target !== null) {
                                treat(this.crew, task.target as Station);
                                this.say(station, 'intercom.first_aid_done', { station: task.target });
                            }
                            break;
                        case 'emergency_gear':
                            this.sim.aircraft.modifiers = { ...this.sim.aircraft.modifiers, manualGearDown: true };
                            this.say(station, 'intercom.gear_cranked');
                            break;
                        case 'fuel_transfer':
                            this.transferFuel(model.fuel_transfer_kg_s * 20);
                            break;
                    }

                    this.event('task_done', { station, kind: task.kind });
                }
            }
        }
    }

    /** Ручная перекачка: из протекающих баков в целые. */
    private transferFuel(amountKg: number): void {
        const a = this.sim.aircraft;
        const leaks = a.modifiers.fuelLeakKgS;
        const fuel = [...a.fuelKg];
        const sources = fuel.map((_, i) => i).filter((i) => (leaks[i] ?? 0) > 0.05);
        const sinks = fuel.map((_, i) => i).filter((i) => (leaks[i] ?? 0) <= 0.05);
        const tanks = this.config.fuel.gameplay_tanks.value;

        for (const s of sources) {
            let moved = Math.min(fuel[s] ?? 0, amountKg);

            for (const k of sinks) {
                const room = (tanks[k]?.capacity_kg ?? 0) - (fuel[k] ?? 0);
                const m = Math.min(room, moved);

                fuel[k] = (fuel[k] ?? 0) + m;
                fuel[s] = (fuel[s] ?? 0) - m;
                moved -= m;
            }
        }

        this.sim.patchAircraft({ fuelKg: fuel });
    }

    // ───────────────────────────── состав ввода ─────────────────────────────

    /** Ввод самолёта из органов пилота (или второго пилота) и второго пилота (раздел 6.1, 6.2). */
    composeInput(): AircraftInput {
        const input = defaultInput();
        const flying = this.crew.flyingStation === 'copilot' ? this.copilotFlight : this.pilot;
        const flyer = this.member(this.crew.flyingStation);
        const k = isActive(flyer) ? 1 : 0;
        const c = this.copilot;

        input.pitch = flying.pitch * k;
        input.roll = flying.roll * k;
        input.yaw = flying.yaw * k;
        input.brakeLeft = flying.brakeLeft * k;
        input.brakeRight = flying.brakeRight * k;
        input.trimPitchRate = flying.trimPitchRate;
        input.trimRollRate = flying.trimRollRate;
        input.trimYawRate = flying.trimYawRate;
        input.gearDown = c.gearDown;
        input.flaps = c.flaps;
        input.bayDoorsOpen = this.doorsCommand;
        input.batteryOn = c.battery;
        input.fuelPumpOn = c.fuelPump;
        input.engines = [0, 1].map((i) => ({
            throttle: flying.throttle[i] ?? 0,
            prop: c.prop[i] ?? 1,
            mixture: c.mixture[i] ?? 1,
            magnetos: c.magnetos[i] ?? false,
            starter: c.starter[i] ?? false,
            primer: c.primer[i] ?? false,
            feather: c.feather[i] ?? false,
            cowlFlaps: c.cowl[i] ?? 0.5,
        })) as AircraftInput['engines'];

        return input;
    }

    /** Применить непрерывный ввод игрока на его станции. */
    applyHuman(station: Station, controls: HumanControls): void {
        if (!isActive(this.member(station))) {
            return;
        }

        if (controls.flight !== undefined) {
            if (station === 'pilot' || (station === 'copilot' && this.crew.flyingStation === 'copilot')) {
                const target = station === 'pilot' ? this.pilot : this.copilotFlight;

                Object.assign(target, controls.flight);
            }
        }

        if (controls.mount !== undefined && controls.mountId !== undefined) {
            const mount = this.mounts.find((m) => m.id === controls.mountId);

            if (mount && mount.station === station) {
                this.mountCommands[mount.id] = controls.mount;
            }
        }
    }

    // ───────────────────────────── шаг ─────────────────────────────

    /** Можно ли ускорить время ×2/×4: фазы 5 и 8, рядом нет угроз (раздел 8.2). */
    canAccelerate(): boolean {
        const a = this.sim.aircraft;
        const fightersNear = this.fighters.some((f) => f.phase !== 'down' && distance2(f.position, a.position) < 15000);

        return (this.phase === 'route' || this.phase === 'return') && !fightersNear && this.tick - this.lastFlakTick > 30 * TICK_HZ;
    }

    step(): void {
        const dt = DT;

        if (this.phase === 'debrief') {
            return;
        }

        this.stepTriggers();

        for (const station of STATIONS) {
            if (this.aiControls(station)) {
                this.ai[station]?.update(this, dt);
            }
        }

        // Пилот выбыл — второй пилот берёт управление (сам, если пилот не подтвердил за 5 с).
        if (this.crew.flyingStation === 'pilot' && !isActive(this.member('pilot')) && isActive(this.member('copilot'))) {
            if (this.crew.takeControlRequestedTick === null) {
                this.crew.takeControlRequestedTick = this.tick;
            } else if (this.tick - this.crew.takeControlRequestedTick > 5 * TICK_HZ || this.aiControls('copilot')) {
                this.handOver();
            }
        }

        // Без второго пилота шасси и закрылки по приказу выполняет сам пилот.
        if (!isActive(this.member('copilot'))) {
            if (this.orders.gearDown !== null) {
                this.copilot.gearDown = this.orders.gearDown;
            }

            if (this.orders.flaps !== null) {
                this.copilot.flaps = this.orders.flaps;
            }
        }

        this.prevBomberPosition = { ...this.sim.aircraft.position };
        this.sim.step(this.composeInput());

        const ctx = this.damageContext();

        stepDamage(ctx, this.damage, dt);

        // Разрушение конструкции: самолёт неуправляем, экипажу остаётся только покинуть его.
        this.aircraftLost = this.damage.structuralFailure || (this.damage.wingDestroyed[0] && this.damage.wingDestroyed[1]);

        this.stepBombing(dt);
        this.stepGuns(dt);
        this.stepFighters(dt);
        this.stepBullets(dt);
        this.stepFlak(dt);
        this.stepWingmen(dt);

        this.stepNavigation(dt);

        this.radio.failed = failed(this.damage, 'radio');

        for (const message of stepRadio(this.radio, this.tick, isActive(this.member('radio')))) {
            this.event('message_received', { id: message.messageId });
            this.say('radio', 'intercom.message_received', { group: message.group });
        }

        this.stepCrew(dt);
        this.stepMetrics(dt);

        if (this.tick % (5 * TICK_HZ) === 0) {
            const p = this.sim.aircraft.position;

            this.track.push({ t: Math.round(this.timeS), x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z) });
        }

        if (this.phaseHook === null || !this.phaseHook(this)) {
            this.stepPhase();
        }
    }

    /** Завершить вылет (тренировки, выход из миссии). */
    end(outcome: Outcome | null): void {
        if (outcome === null) {
            this.event('outcome', { outcome: 'aborted' });
            this.setPhase('debrief');
        } else {
            this.finish(outcome);
        }
    }

    /**
     * Счисление и расчёты штурмана: смена участков по счисленному месту, курс с поправкой
     * на оценку ветра, расчётное время и скорость для выхода на цель в окно (раздел 6.3).
     */
    private stepNavigation(dt: number): void {
        const d = this.derived();
        const nav = this.nav;

        stepDeadReckoning(nav, d.heading, d.trueAirspeed, dt);

        if (this.difficulty === 'training') {
            nav.dr = { x: this.sim.aircraft.position.x, y: this.sim.aircraft.position.y };
        }

        const next = this.waypointPosition(nav.legIndex);
        const prev = this.waypointPosition(nav.legIndex - 1);

        if (next === null) {
            nav.courseToSteer = null;

            return;
        }

        // Участок пройден: рядом с точкой или за траверзом (по счислению).
        const legTrack = prev !== null ? bearing(prev, next) : bearing(nav.dr, next);
        const toNext = { x: next.x - nav.dr.x, y: next.y - nav.dr.y };
        const alongRemaining = toNext.x * Math.sin(legTrack) + toNext.y * Math.cos(legTrack);
        const isTarget = this.waypoints[nav.legIndex]?.type === 'target';

        if (!isTarget && nav.legIndex < this.waypoints.length - 1 && (Math.hypot(toNext.x, toNext.y) < 1500 || alongRemaining < 0)) {
            nav.legIndex++;
            nav.log.push({ tick: this.tick, heading: d.heading, tasMs: d.trueAirspeed, altitudeM: d.altitude, note: this.waypoints[nav.legIndex - 1]?.id ?? '' });
            this.say('navigator', 'intercom.waypoint', { id: this.waypoints[nav.legIndex - 1]?.id ?? '' });

            return;
        }

        // Точка «цель» закрывается, когда бомбы сброшены (или боевой курс прерван).
        if (isTarget && this.phase !== 'bomb_run' && this.phase !== 'route' && this.phase !== 'formup') {
            nav.legIndex = Math.min(nav.legIndex + 1, this.waypoints.length - 1);
        }

        const solution = courseToSteerFor(nav.dr, next, d.trueAirspeed, nav.windEst);

        // Курс пилоту: расчёт непрерывный, а новый курс объявляется по СПУ не чаще раза в 45 с.
        const announced = this.announcedCourse;
        const changed = announced === null || Math.abs(wrapPi(solution.heading - announced)) > (3 * Math.PI) / 180;

        if (changed && this.tick - this.lastCourseTick > 45 * TICK_HZ && isActive(this.member('navigator'))) {
            if (announced !== null) {
                nav.corrections++;
            }

            this.announcedCourse = solution.heading;
            this.lastCourseTick = this.tick;
            this.say('navigator', 'intercom.course', { heading: Math.round(((solution.heading * 180) / Math.PI + 360) % 360) });
        }

        nav.courseToSteer = solution.heading;

        // Время над целью: расчётное и требуемая скорость.
        const targetIndex = this.waypoints.findIndex((w) => w.type === 'target');
        let remaining = Math.hypot(toNext.x, toNext.y);

        for (let i = nav.legIndex; i < targetIndex; i++) {
            const a = this.waypointPosition(i);
            const b = this.waypointPosition(i + 1);

            if (a && b) {
                remaining += distance2(a, b);
            }
        }

        const gs = Math.max(solution.groundSpeedMs, 30);

        nav.etaS = targetIndex >= nav.legIndex ? this.timeS + remaining / gs : null;

        if (nav.etaS !== null) {
            const left = this.mission.time_over_target.at_s - this.timeS;
            const required = left > 60 ? remaining / left : null;
            const density = Math.sqrt(isaDensityRatio(d.altitude));

            nav.requiredIasMs = required === null ? null : clamp((required - (gs - d.trueAirspeed)) * density, 72, 112);
        } else {
            nav.requiredIasMs = null;
        }
    }

    private stepMetrics(dt: number): void {
        void dt;

        if (this.phase !== 'bomb_run') {
            return;
        }

        const d = this.derived();
        const m = this.metrics.bombRun;

        if (m.refAltitude === null || m.refIas === null || m.refCourse === null) {
            const t = this.knownTarget();

            m.refAltitude = d.altitude;
            m.refIas = d.indicatedAirspeed;
            m.refCourse = bearing(this.sim.aircraft.position, t.aim);
        }

        // Отклонение курса считаем по стрелке PDI, если прицел включён, иначе — от курса на цель.
        const readout = this.sightReadout();
        const headingError = readout !== null && this.sight.on ? readout.pdi : wrapPi(m.refCourse - d.heading);

        m.samples++;
        m.headingSq += headingError ** 2;
        m.altitudeSq += (d.altitude - m.refAltitude) ** 2;
        m.speedSq += (d.indicatedAirspeed - m.refIas) ** 2;
    }

    run(ticks: number): void {
        for (let i = 0; i < ticks && this.phase !== 'debrief'; i++) {
            this.step();
        }
    }

    /** Хэш мира для проверки детерминизма. */
    stateHash(): string {
        return hashState({
            sim: this.sim.stateHash(),
            rng: this.rng.getState(),
            phase: this.phase,
            damage: this.damage,
            fighters: this.fighters.map((f) => [f.position, f.hp, f.phase]),
            bombs: this.impacts.map((i) => i.position),
            crew: Object.values(this.crew.members).map((m) => [m.health, m.efficiency]),
            mounts: this.mounts.map((m) => [m.ammo, m.az, m.el]),
        });
    }

    zoneShare(zone: ZoneId): number {
        const hp = this.config.damage_model.value.zones.find((z) => z.id === zone)?.hp ?? 1;

        return this.damage.zoneHp[zone] / hp;
    }

    /** Видимые эффекты: разрывы зениток и бомб в последние секунды (для рендера). */
    recentImpacts(): Impact[] {
        return this.impacts.filter((i) => this.tick - i.tick < IMPACT_VISIBLE_S * TICK_HZ);
    }

    checklistDefs(): Record<ChecklistId, string[]> {
        const out = {} as Record<ChecklistId, string[]>;

        for (const id of Object.keys(CHECKLISTS) as ChecklistId[]) {
            out[id] = CHECKLISTS[id].map((i) => i.id);
        }

        return out;
    }

    static readonly DEFAULT_INTERVAL_TICKS = DEFAULT_INTERVAL_TICKS;
}
