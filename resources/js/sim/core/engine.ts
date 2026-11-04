import type { AtmosphereSample } from './atmosphere';
import { PA_PER_INHG } from './atmosphere';
import type { AircraftConfig } from './config';
import { approach, clamp, interpolateTable } from './math';

const HP_TO_W = 745.7;
const KELVIN = 273.15;

/** Конечный автомат запуска (раздел 6.2): аккумулятор → насос → праймер → стартер → магнето → смесь. */
export type EngineMode = 'off' | 'cranking' | 'running' | 'failed';

export type EngineState = {
    mode: EngineMode;
    rpm: number;
    manifoldInHg: number;
    powerW: number;
    thrustN: number;
    /** Сопротивление авторотирующего/зафлюгированного винта, Н. */
    propDragN: number;
    chtC: number;
    /** Накопленный износ 0..1 от перенаддува и перегрева. */
    wear: number;
    fuelFlowKgS: number;
    feathered: boolean;
    primed: number;
    crankingS: number;
    fire: boolean;
    secondsInRed: number;
};

export type EngineControls = {
    throttle: number;
    /** Рычаг шага винта: 0 — минимальные обороты, 1 — максимальные. */
    prop: number;
    /** 0 — отсечка, 1 — авто-богатая. */
    mixture: number;
    magnetos: boolean;
    starter: boolean;
    primer: boolean;
    feather: boolean;
    cowlFlaps: number;
};

export type EngineEnvironment = {
    atmosphere: AtmosphereSample;
    trueAirspeed: number;
    dynamicPressure: number;
    batteryOn: boolean;
    fuelPumpOn: boolean;
    fuelAvailable: boolean;
};

export const defaultEngineControls = (): EngineControls => ({
    throttle: 0,
    prop: 1,
    mixture: 1,
    magnetos: false,
    starter: false,
    primer: false,
    feather: false,
    cowlFlaps: 1,
});

export function createEngine(config: AircraftConfig, running: boolean, ambientC = 15): EngineState {
    const curve = config.engines.power_curve.value;

    return {
        mode: running ? 'running' : 'off',
        rpm: running ? curve.rpm_idle : 0,
        manifoldInHg: running ? curve.mp_idle_inhg : 29.92,
        powerW: 0,
        thrustN: 0,
        propDragN: 0,
        chtC: running ? 150 : ambientC,
        wear: 0,
        fuelFlowKgS: 0,
        feathered: false,
        primed: running ? 1 : 0,
        crankingS: 0,
        fire: false,
        secondsInRed: 0,
    };
}

/** Максимальный наддув при полностью открытом РУД на высоте (с учётом нагнетателя). */
export function fullThrottleManifold(config: AircraftConfig, altitudeM: number): number {
    return interpolateTable(config.engines.power_curve.value.full_throttle_mp_inhg as [number, number][], altitudeM);
}

/** Тяга винта постоянных оборотов: T = η·P / sqrt(V² + V0²). */
export function propellerThrust(config: AircraftConfig, powerW: number, trueAirspeed: number): number {
    const prop = config.propellers.gameplay_model.value;
    const v = Math.max(trueAirspeed, 0);

    return (prop.eta_max * powerW) / Math.sqrt(v * v + prop.v0_ms * prop.v0_ms);
}

export function stepEngine(
    config: AircraftConfig,
    engine: EngineState,
    controls: EngineControls,
    env: EngineEnvironment,
    dt: number,
): EngineState {
    const curve = config.engines.power_curve.value;
    const limits = config.engines.gameplay_limits.value;
    const prop = config.propellers.gameplay_model.value;
    const next: EngineState = { ...engine };
    const ambientPressureInHg = env.atmosphere.pressurePa / PA_PER_INHG;
    const ambientC = env.atmosphere.temperatureK - KELVIN;

    if (controls.primer && env.fuelPumpOn) {
        next.primed = Math.min(3, next.primed + dt * 2);
    }

    const canRun = controls.magnetos && controls.mixture > 0.05 && env.fuelAvailable;

    switch (engine.mode) {
        case 'off':
            if (controls.starter && env.batteryOn) {
                next.mode = 'cranking';
                next.crankingS = 0;
            }
            break;
        case 'cranking':
            next.crankingS += dt;

            if (!controls.starter || !env.batteryOn) {
                next.mode = 'off';
            } else if (next.crankingS >= 2 && canRun && next.primed >= 1) {
                next.mode = 'running';
                next.primed = 0;
            }
            break;
        case 'running':
            if (!canRun) {
                next.mode = 'off';
            }
            break;
        case 'failed':
            break;
    }

    // Флюгирование: моментально по команде, расфлюгирование — только у работающего двигателя.
    if (controls.feather) {
        next.feathered = true;
    } else if (next.feathered && next.mode === 'running') {
        next.feathered = false;
    }

    const running = next.mode === 'running' && !next.feathered;

    // Наддув.
    const mpMax = Math.min(fullThrottleManifold(config, env.atmosphere.pressurePa > 0 ? pressureAltitude(env.atmosphere.pressurePa) : 0), limits.mp_max_inhg);
    const mpTarget = running
        ? curve.mp_idle_inhg + clamp(controls.throttle, 0, 1) * Math.max(mpMax - curve.mp_idle_inhg, 0)
        : ambientPressureInHg;

    next.manifoldInHg = approach(engine.manifoldInHg, mpTarget, curve.spool_tau_s, dt);

    // Обороты: регулятор постоянных оборотов держит заданные, пока хватает мощности.
    const governed = curve.rpm_min_governed + clamp(controls.prop, 0, 1) * (curve.rpm_rated - curve.rpm_min_governed);
    let rpmTarget: number;

    if (next.mode === 'cranking') {
        rpmTarget = 150;
    } else if (running) {
        const powerLimited = curve.rpm_idle + (curve.rpm_rated - curve.rpm_idle) * clamp((controls.throttle - 0.04) * 4 + env.trueAirspeed / 60, 0, 1);

        rpmTarget = Math.min(governed, powerLimited);
    } else if (next.feathered) {
        rpmTarget = 0;
    } else {
        // Авторотация от набегающего потока.
        rpmTarget = Math.min(governed, env.trueAirspeed * 18);
    }

    next.rpm = Math.max(0, approach(engine.rpm, rpmTarget, prop.governor_tau_s, dt));

    // Мощность ∝ наддув × обороты.
    if (running) {
        const mixtureFactor = clamp(0.6 + 0.4 * controls.mixture, 0, 1);
        const wearFactor = 1 - 0.5 * next.wear;

        next.powerW = Math.max(
            0,
            config.engines.rated_power_hp.value * HP_TO_W *
                ((next.manifoldInHg - curve.mp_idle_inhg * 0.5) / (curve.mp_rated_inhg - curve.mp_idle_inhg * 0.5)) *
                (next.rpm / curve.rpm_rated) *
                mixtureFactor *
                wearFactor,
        );
    } else {
        next.powerW = 0;
    }

    next.thrustN = propellerThrust(config, next.powerW, env.trueAirspeed);

    // Сопротивление винта при отказе: авторотация сильнее, флюгер — почти ноль.
    next.propDragN = running
        ? 0
        : prop.windmill_drag_n_per_pa * env.dynamicPressure * (next.feathered ? prop.feathered_drag_factor : 1);

    next.fuelFlowKgS = running ? (next.powerW / 1000) * curve.bsfc_kg_per_kwh / 3600 * (0.85 + 0.3 * controls.mixture) : 0;

    // Температура головок цилиндров: инерционное звено, обдув от скорости и створок.
    const powerFraction = next.powerW / (config.engines.rated_power_hp.value * HP_TO_W);
    const cooling = 1 + curve.cowl_cooling * clamp(controls.cowlFlaps, 0, 1) + env.trueAirspeed / 90;
    const chtTarget = ambientC + (running || next.mode === 'cranking' ? (curve.cht_heat_c * (0.35 + powerFraction)) / cooling * 1.6 : 0);

    next.chtC = approach(engine.chtC, chtTarget, curve.cht_tau_s, dt);

    // Износ: перенаддув и перегрев.
    const overboost = next.manifoldInHg > curve.mp_rated_inhg + 0.5;
    const overheat = next.chtC > limits.cht_max_c;

    if (overboost || overheat || next.rpm > limits.rpm_max) {
        next.secondsInRed += dt;
    }

    next.wear = clamp(
        next.wear + (overboost ? limits.overboost_wear_per_s * dt : 0) + (overheat ? limits.overheat_wear_per_s * dt : 0),
        0,
        1,
    );

    if (next.wear >= 1 && next.mode === 'running') {
        next.mode = 'failed';
    }

    return next;
}

/** Высота по давлению МСА (для таблицы нагнетателя). */
export function pressureAltitude(pressurePa: number): number {
    return (1 - Math.pow(pressurePa / 101325, 0.190263)) * 44330.8;
}
