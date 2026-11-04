import type { WeatherConfig } from './atmosphere';
import { GRAVITY, isa, SEA_LEVEL, turbulenceAt, windAt } from './atmosphere';
import type { AircraftConfig } from './config';
import type { EngineControls, EngineState } from './engine';
import { createEngine, defaultEngineControls, stepEngine } from './engine';
import type { Quat, Vec3 } from './math';
import {
    add,
    attitudeFromEuler,
    clamp,
    cross,
    dot,
    eulerFromAttitude,
    integrateQuat,
    length,
    moveTowards,
    normalize,
    rotate,
    rotateInverse,
    scale,
    sub,
    vec,
} from './math';
import type { Rng } from './rng';
import type { Terrain } from './terrain';

/** Ввод экипажа за тик. Оси -1..1, рычаги 0..1. */
export type AircraftInput = {
    /** +1 — штурвал на себя (нос вверх). */
    pitch: number;
    /** +1 — крен вправо. */
    roll: number;
    /** +1 — правая педаль (нос вправо). */
    yaw: number;
    brakeLeft: number;
    brakeRight: number;
    /** Скорость изменения триммеров -1/0/1 по осям. */
    trimPitchRate: number;
    trimRollRate: number;
    trimYawRate: number;
    gearDown: boolean;
    /** Заданное положение закрылков 0..1. */
    flaps: number;
    bayDoorsOpen: boolean;
    batteryOn: boolean;
    fuelPumpOn: boolean;
    engines: [EngineControls, EngineControls];
};

export type GroundContact = 'air' | 'gear' | 'belly' | 'water' | 'crashed';

export type Loadout = {
    fuelKg: number;
    crew: number;
    ammoKg: number;
    bombsKg: number;
};

export type AircraftState = {
    position: Vec3;
    velocity: Vec3;
    attitude: Quat;
    /** Угловая скорость в связанных осях FRD: p (крен), q (тангаж), r (рыскание), рад/с. */
    omega: Vec3;
    trim: { pitch: number; roll: number; yaw: number };
    controls: { elevator: number; aileron: number; rudder: number };
    gear: number;
    flaps: number;
    bayDoors: number;
    fuelKg: number[];
    loadout: Loadout;
    engines: [EngineState, EngineState];
    /** Отказ двигателя (повреждение), индекс → true. */
    engineFailed: [boolean, boolean];
    contact: GroundContact;
    /** Вертикальная скорость в момент последнего касания, м/с (метрика посадки, раздел 6.1). */
    touchdownVs: number | null;
    stallSide: number;
    hydraulicPressure: number;
    batteryOn: boolean;
    fuelPumpOn: boolean;
    /** Ускорение в связанных осях без гравитации (для указателя скольжения и перегрузки), м/с². */
    specificForce: Vec3;
};

export type AircraftDerived = {
    altitude: number;
    agl: number;
    trueAirspeed: number;
    indicatedAirspeed: number;
    verticalSpeed: number;
    alpha: number;
    beta: number;
    heading: number;
    pitch: number;
    roll: number;
    gLoad: number;
    slip: number;
    turnRate: number;
    massKg: number;
    machNumber: number;
};

export type InitialConditions = {
    position: Vec3;
    heading: number;
    pitch?: number;
    roll?: number;
    speed: number;
    gearDown: boolean;
    flaps?: number;
    enginesRunning: boolean;
    loadout: Loadout;
    /** Старт на земле (стоянка, полоса): касание при старте не считается посадкой. */
    onGround?: boolean;
};

export const defaultInput = (): AircraftInput => ({
    pitch: 0,
    roll: 0,
    yaw: 0,
    brakeLeft: 0,
    brakeRight: 0,
    trimPitchRate: 0,
    trimRollRate: 0,
    trimYawRate: 0,
    gearDown: true,
    flaps: 0,
    bayDoorsOpen: false,
    batteryOn: true,
    fuelPumpOn: true,
    engines: [defaultEngineControls(), defaultEngineControls()],
});

/** Ввод с работающими двигателями: магнето и смесь включены. */
export const runningInput = (throttle = 0, prop = 1): AircraftInput => {
    const input = defaultInput();

    for (const engine of input.engines) {
        engine.magnetos = true;
        engine.throttle = throttle;
        engine.prop = prop;
        engine.cowlFlaps = 0.3;
    }

    return input;
};

export function totalFuel(state: AircraftState): number {
    return state.fuelKg.reduce((a, b) => a + b, 0);
}

/** Масса: пустой + топливо + экипаж + боекомплект + бомбы (раздел 7.1). */
export function massOf(config: AircraftConfig, state: AircraftState): number {
    return (
        config.mass.empty_kg.value +
        totalFuel(state) +
        state.loadout.crew * config.mass.crew_member_kg.value +
        state.loadout.ammoKg +
        state.loadout.bombsKg
    );
}

/** Смещение ЦМ по оси x от опорной точки (опорная точка = ЦМ пустого самолёта, TODO(history)). */
export function cgOffsetX(config: AircraftConfig, state: AircraftState): number {
    const tanks = config.fuel.gameplay_tanks.value;
    let moment = 0;

    tanks.forEach((tank, i) => {
        moment += (state.fuelKg[i] ?? 0) * tank.x_m;
    });
    moment += state.loadout.bombsKg * config.bomb_bay.gameplay_x_m.value;

    return moment / massOf(config, state);
}

export function createAircraft(config: AircraftConfig, ic: InitialConditions): AircraftState {
    const attitude = attitudeFromEuler(ic.heading, ic.pitch ?? 0, ic.roll ?? 0);
    const forward = rotate(attitude, vec(1, 0, 0));
    const tanks = config.fuel.gameplay_tanks.value;
    const capacity = tanks.reduce((a, t) => a + t.capacity_kg, 0);
    const fuelKg = tanks.map((t) => (ic.loadout.fuelKg * t.capacity_kg) / capacity);

    return {
        position: { ...ic.position },
        velocity: scale(forward, ic.speed),
        attitude,
        omega: vec(),
        trim: { pitch: 0, roll: 0, yaw: 0 },
        controls: { elevator: 0, aileron: 0, rudder: 0 },
        gear: ic.gearDown ? 1 : 0,
        flaps: ic.flaps ?? 0,
        bayDoors: 0,
        fuelKg,
        loadout: { ...ic.loadout },
        engines: [createEngine(config, ic.enginesRunning), createEngine(config, ic.enginesRunning)],
        engineFailed: [false, false],
        contact: ic.onGround === true ? 'gear' : 'air',
        touchdownVs: null,
        stallSide: 0,
        hydraulicPressure: ic.enginesRunning ? 1 : 0,
        batteryOn: true,
        fuelPumpOn: true,
        specificForce: vec(0, 0, -GRAVITY),
    };
}

/** Аэродинамические силы и моменты в связанных осях. */
export type AeroResult = {
    force: Vec3;
    moment: Vec3;
    alpha: number;
    beta: number;
    cl: number;
    cd: number;
    dynamicPressure: number;
    stalled: boolean;
};

export function aerodynamics(
    config: AircraftConfig,
    state: AircraftState,
    airVelocityBody: Vec3,
    density: number,
    agl: number,
): AeroResult {
    const a = config.aero;
    const S = config.geometry.wing_area_m2.value;
    const b = config.geometry.wingspan_m.value;
    const c = config.geometry.mean_chord_m.value;
    const V = Math.max(length(airVelocityBody), 0.1);
    const qbar = 0.5 * density * V * V;
    const alpha = Math.atan2(airVelocityBody.z, airVelocityBody.x);
    const beta = Math.asin(clamp(airVelocityBody.y / V, -1, 1));
    const { p, q, r } = { p: state.omega.x, q: state.omega.y, r: state.omega.z };
    const de = state.controls.elevator;
    const da = state.controls.aileron;
    const dr = state.controls.rudder;

    // Подъёмная сила с закрылками и сваливанием.
    const flapsCl = a.cl_flaps_delta * state.flaps;
    const clMax = a.cl_max + flapsCl;
    const alphaStall = (clMax - a.cl0 - flapsCl) / a.cl_alpha_per_rad;
    const linear = a.cl0 + flapsCl + a.cl_alpha_per_rad * alpha;
    const stalled = alpha > alphaStall || alpha < -alphaStall * 0.8;
    let cl: number;

    if (alpha > alphaStall) {
        cl = Math.max(clMax + a.cl_post_stall_slope_per_rad * (alpha - alphaStall), 0.6 * Math.sin(2 * alpha));
    } else if (alpha < -alphaStall * 0.8) {
        cl = Math.min(-0.8 * clMax - a.cl_post_stall_slope_per_rad * (alpha + alphaStall * 0.8), 0.6 * Math.sin(2 * alpha));
    } else {
        cl = linear;
    }

    // Экранный эффект: меньше индуктивное сопротивление у земли.
    const hb = Math.max(agl, 0.5) / (b * a.ground_effect_span_factor);
    const groundEffect = hb < 1 ? (16 * hb) ** 2 / (1 + (16 * hb) ** 2) : 1;

    const cdStall = stalled ? a.cd_stall_per_rad * Math.abs(Math.abs(alpha) - alphaStall) : 0;
    const cd =
        a.cd0 +
        a.k_induced * cl * cl * groundEffect +
        a.cd_gear * state.gear +
        a.cd_bay_doors * state.bayDoors +
        a.cd_flaps * state.flaps +
        cdStall +
        0.3 * beta * beta;
    const cy = a.cy_beta * beta + a.cy_rudder * dr;

    const lift = qbar * S * cl;
    const drag = qbar * S * cd;
    const ca = Math.cos(alpha);
    const sa = Math.sin(alpha);
    const force = vec(-drag * ca + lift * sa, qbar * S * cy, -lift * ca - drag * sa);

    const pHat = (p * b) / (2 * V);
    const qHat = (q * c) / (2 * V);
    const rHat = (r * b) / (2 * V);
    const stallRoll = stalled ? a.cl_stall_asymmetry * state.stallSide * Math.min(Math.abs(alpha) - alphaStall, 0.3) * 10 : 0;

    const Cl = a.cl_beta * beta + a.cl_p * pHat + a.cl_r * rHat + a.cl_aileron * da + stallRoll;
    const Cm =
        a.cm0 +
        a.cm_alpha * Math.sin(alpha) +
        a.cm_q * qHat +
        a.cm_elevator * de +
        a.cm_flaps * state.flaps -
        (cl * cgOffsetX(config, state)) / c;
    const Cn = a.cn_beta * beta + a.cn_r * rHat + a.cn_p * pHat + a.cn_rudder * dr + a.cn_aileron * da;

    return {
        force,
        moment: vec(qbar * S * b * Cl, qbar * S * c * Cm, qbar * S * b * Cn),
        alpha,
        beta,
        cl,
        cd,
        dynamicPressure: qbar,
        stalled,
    };
}

/** Тяга и сопротивление винтов, моменты от асимметрии (раздел 7.1). */
export function propulsion(config: AircraftConfig, engines: [EngineState, EngineState]): { force: Vec3; moment: Vec3 } {
    const arm = config.geometry.engine_arm_m.value;
    let fx = 0;
    let n = 0;

    engines.forEach((engine, i) => {
        const y = i === 0 ? -arm : arm;
        const net = engine.thrustN - engine.propDragN;

        fx += net;
        // M = r × F, r = (0, y, 0), F = (net, 0, 0) → N = -y·net.
        n += -y * net;
    });

    return { force: vec(fx, 0, 0), moment: vec(0, 0, n) };
}

type ContactResult = { force: Vec3; moment: Vec3; touching: boolean; maxSinkRate: number; water: boolean };

function groundContacts(
    config: AircraftConfig,
    state: AircraftState,
    input: AircraftInput,
    terrain: Terrain,
    trueAirspeed: number,
): ContactResult {
    const g = config.gear;
    const nose = g.gameplay_nose_wheel.value;
    let force = vec();
    let moment = vec();
    let touching = false;
    let maxSinkRate = 0;
    let water = false;
    const forwardWorld = rotate(state.attitude, vec(1, 0, 0));

    const contact = (
        r: [number, number, number],
        spring: number,
        damper: number,
        maxCompression: number,
        rolling: { brake: number; steer: number } | null,
    ): void => {
        const rWorld = rotate(state.attitude, vec(r[0], r[1], r[2]));
        const point = add(state.position, rWorld);
        const groundZ = terrain.heightAt(point.x, point.y);
        const depth = groundZ - point.z;

        if (depth <= 0) {
            return;
        }

        touching = true;

        if (terrain.isWater(point.x, point.y)) {
            water = true;
        }

        const pointVel = add(state.velocity, rotate(state.attitude, cross(state.omega, vec(r[0], r[1], r[2]))));

        maxSinkRate = Math.max(maxSinkRate, -pointVel.z);

        const compression = Math.min(depth, maxCompression * 1.5);
        const hardStop = depth > maxCompression ? (depth - maxCompression) * spring * 4 : 0;
        const normal = Math.max(0, spring * compression + hardStop - damper * pointVel.z);

        // Направление качения: продольная ось самолёта в горизонте, повёрнутая на угол руления.
        let fwd = normalize(vec(forwardWorld.x, forwardWorld.y, 0));

        if (rolling !== null && rolling.steer !== 0) {
            const cs = Math.cos(rolling.steer);
            const sn = Math.sin(rolling.steer);

            fwd = vec(fwd.x * cs + fwd.y * sn, -fwd.x * sn + fwd.y * cs, 0);
        }

        const side = vec(fwd.y, -fwd.x, 0);
        const vF = dot(pointVel, fwd);
        const vS = dot(pointVel, side);
        let fLong: number;
        let fSide: number;

        if (rolling !== null) {
            const mu = g.mu_roll + g.mu_brake * rolling.brake;

            fLong = -Math.tanh(vF / 0.5) * mu * normal;
            fSide = -clamp(vS / 0.3, -1, 1) * g.mu_lateral * normal;
        } else {
            const planar = Math.hypot(vF, vS);
            const mu = water ? 0.9 : g.mu_belly;
            const k = planar > 0.05 ? (mu * normal * Math.tanh(planar / 0.5)) / planar : 0;

            fLong = -k * vF;
            fSide = -k * vS;
        }

        const f = add(add(vec(0, 0, normal), scale(fwd, fLong)), scale(side, fSide));

        force = add(force, f);
        moment = add(moment, cross(rWorld, f));
    };

    if (state.gear > 0.98) {
        for (const point of g.points) {
            const brake = point.brake === 'left' ? input.brakeLeft : point.brake === 'right' ? input.brakeRight : 0;
            const steerFade = clamp(1 - trueAirspeed / nose.fade_speed_ms, 0, 1);
            const steer = point.steerable ? input.yaw * ((nose.max_deg * Math.PI) / 180) * steerFade : 0;

            contact(point.r_m, point.spring_n_per_m, point.damper_n_s_per_m, point.max_compression_m, {
                brake: clamp(brake, 0, 1),
                steer,
            });
        }
    }

    for (const point of g.belly_points) {
        contact(point.r_m, 600000, 90000, 0.3, null);
    }

    return { force, moment: rotateInverse(state.attitude, moment), touching, maxSinkRate, water };
}

export type StepContext = {
    config: AircraftConfig;
    terrain: Terrain;
    weather: WeatherConfig;
    rng: Rng;
    seed: number;
    timeS: number;
    dt: number;
};

/** Один фиксированный шаг 1/60 с: полунеявный Эйлер (раздел 7.1). */
export function stepAircraft(state: AircraftState, input: AircraftInput, ctx: StepContext): AircraftState {
    const { config, terrain, weather, dt } = ctx;

    if (state.contact === 'crashed') {
        return state;
    }

    const a = config.aero;
    const s: AircraftState = {
        ...state,
        trim: { ...state.trim },
        controls: { ...state.controls },
        fuelKg: [...state.fuelKg],
    };

    // Органы управления с ограничением скорости отклонения.
    const trimRate = 0.1 * dt;

    s.trim.pitch = clamp(s.trim.pitch + input.trimPitchRate * trimRate, -a.trim_max, a.trim_max);
    s.trim.roll = clamp(s.trim.roll + input.trimRollRate * trimRate, -a.trim_max, a.trim_max);
    s.trim.yaw = clamp(s.trim.yaw + input.trimYawRate * trimRate, -a.trim_max, a.trim_max);

    const surfaceRate = 2.5 * dt;
    const pitchCmd = clamp(input.pitch + s.trim.pitch, -1, 1);
    const rollCmd = clamp(input.roll + s.trim.roll, -1, 1);
    const yawCmd = clamp(input.yaw + s.trim.yaw, -1, 1);

    s.controls.elevator = moveTowards(s.controls.elevator, -pitchCmd * a.elevator_max_rad, surfaceRate * a.elevator_max_rad);
    s.controls.aileron = moveTowards(s.controls.aileron, rollCmd * a.aileron_max_rad, surfaceRate * a.aileron_max_rad);
    s.controls.rudder = moveTowards(s.controls.rudder, -yawCmd * a.rudder_max_rad, surfaceRate * a.rudder_max_rad);

    // Гидравлика от насосов на двигателях → шасси, закрылки, люк (раздел 7.2).
    const pumpsOn = state.engines.some((e) => e.mode === 'running' && e.rpm > 800);

    s.hydraulicPressure = moveTowards(state.hydraulicPressure, pumpsOn ? 1 : 0, dt / (pumpsOn ? 2 : 60));

    const hydraulic = s.hydraulicPressure > 0.3;

    if (hydraulic) {
        s.gear = moveTowards(s.gear, input.gearDown ? 1 : 0, dt / config.gear.retract_time_s);
        s.flaps = moveTowards(s.flaps, clamp(input.flaps, 0, 1), dt / 10);
        s.bayDoors = moveTowards(s.bayDoors, input.bayDoorsOpen ? 1 : 0, dt / 3);
    }

    s.batteryOn = input.batteryOn;
    s.fuelPumpOn = input.fuelPumpOn;

    // Атмосфера и воздушная скорость.
    const atm = isa(s.position.z);
    const wind = add(windAt(weather, s.position.z), turbulenceAt(weather, ctx.seed, s.position, ctx.timeS));
    const airVelWorld = sub(s.velocity, wind);
    const airVelBody = rotateInverse(s.attitude, airVelWorld);
    const tas = length(airVelWorld);
    const agl = s.position.z - terrain.heightAt(s.position.x, s.position.y);

    // Двигатели.
    const fuelAvailable = totalFuel(s) > 0.5;
    const qbarEnv = 0.5 * atm.density * tas * tas;

    s.engines = s.engines.map((engine, i) => {
        const failed = s.engineFailed[i] === true;
        const next = stepEngine(
            config,
            failed && engine.mode === 'running' ? { ...engine, mode: 'failed' } : engine,
            input.engines[i] ?? defaultEngineControls(),
            {
                atmosphere: atm,
                trueAirspeed: tas,
                dynamicPressure: qbarEnv,
                batteryOn: s.batteryOn,
                fuelPumpOn: s.fuelPumpOn,
                fuelAvailable,
            },
            dt,
        );

        return next;
    }) as [EngineState, EngineState];

    // Расход топлива из всех баков пропорционально остатку.
    const burn = s.engines.reduce((sum, e) => sum + e.fuelFlowKgS, 0) * dt;
    const fuel = totalFuel(s);

    if (fuel > 0 && burn > 0) {
        s.fuelKg = s.fuelKg.map((kg) => Math.max(0, kg - (burn * kg) / fuel));
    }

    // Сваливание с асимметрией: сторона выбирается ГПСЧ при входе.
    const aero = aerodynamics(config, s, airVelBody, atm.density, agl);

    if (aero.stalled && state.stallSide === 0) {
        s.stallSide = ctx.rng.chance(0.5) ? 1 : -1;
    } else if (!aero.stalled) {
        s.stallSide = 0;
    }

    const prop = propulsion(config, s.engines);
    const ground = groundContacts(config, s, input, terrain, tas);

    const mass = massOf(config, s);
    const inertia = config.mass.inertia_kgm2.value;
    const massScale = mass / config.mass.max_takeoff_kg.value;
    const I = vec(inertia.ixx * massScale, inertia.iyy * massScale, inertia.izz * massScale);

    const forceBody = add(add(aero.force, prop.force), rotateInverse(s.attitude, ground.force));
    const momentBody = add(add(aero.moment, prop.moment), ground.moment);
    const forceWorld = rotate(s.attitude, forceBody);

    s.specificForce = scale(forceBody, 1 / mass);

    // Полунеявный Эйлер: сначала скорости, потом положения.
    const accel = add(scale(forceWorld, 1 / mass), vec(0, 0, -GRAVITY));

    s.velocity = add(s.velocity, scale(accel, dt));
    s.position = add(s.position, scale(s.velocity, dt));

    const w = s.omega;
    const Iw = vec(I.x * w.x, I.y * w.y, I.z * w.z);
    const gyro = cross(w, Iw);
    const angAccel = vec((momentBody.x - gyro.x) / I.x, (momentBody.y - gyro.y) / I.y, (momentBody.z - gyro.z) / I.z);

    s.omega = add(w, scale(angAccel, dt));
    s.attitude = integrateQuat(s.attitude, s.omega, dt);

    // Состояние контакта с землёй.
    if (ground.touching) {
        if (state.contact === 'air') {
            s.touchdownVs = ground.maxSinkRate;
        }

        if (ground.maxSinkRate > config.gear.crash_vertical_speed_ms * (s.gear > 0.98 ? 1 : 0.6)) {
            s.contact = 'crashed';
            s.velocity = vec();
            s.omega = vec();
        } else if (ground.water) {
            s.contact = 'water';
        } else {
            s.contact = s.gear > 0.98 ? 'gear' : 'belly';
        }
    } else {
        s.contact = 'air';
    }

    return s;
}

/** Производные величины для приборов, ИИ и тестов. */
export function derive(config: AircraftConfig, state: AircraftState, terrain: Terrain, weather: WeatherConfig): AircraftDerived {
    const atm = isa(state.position.z);
    const airVelWorld = sub(state.velocity, windAt(weather, state.position.z));
    const airVelBody = rotateInverse(state.attitude, airVelWorld);
    const tas = length(airVelWorld);
    const euler = eulerFromAttitude(state.attitude);
    const gLoad = -state.specificForce.z / GRAVITY;
    const horizontalSpeed = Math.hypot(state.velocity.x, state.velocity.y);

    return {
        altitude: state.position.z,
        agl: state.position.z - terrain.heightAt(state.position.x, state.position.y),
        trueAirspeed: tas,
        indicatedAirspeed: tas * Math.sqrt(atm.density / SEA_LEVEL.density),
        verticalSpeed: state.velocity.z,
        alpha: Math.atan2(airVelBody.z, airVelBody.x),
        beta: tas > 1 ? Math.asin(clamp(airVelBody.y / tas, -1, 1)) : 0,
        heading: euler.heading,
        pitch: euler.pitch,
        roll: euler.roll,
        gLoad,
        slip: clamp(state.specificForce.y / GRAVITY, -1, 1),
        turnRate:
            horizontalSpeed > 5
                ? (state.omega.z * Math.cos(euler.roll) + state.omega.y * Math.sin(euler.roll)) / Math.cos(euler.pitch)
                : state.omega.z,
        massKg: massOf(config, state),
        machNumber: tas / atm.speedOfSound,
    };
}
