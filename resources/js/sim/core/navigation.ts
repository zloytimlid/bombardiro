import { clamp, wrapPi } from './math';
import type { Rng } from './rng';

/**
 * Работа штурмана (раздел 6.3): счисление пути, измерение сноса, решение ветрового
 * треугольника, отметки по ориентирам, радиокомпас. В «Историческом» режиме экипаж знает
 * только счисленное место; в «Учебном» точное место видно на карте.
 */
export type NavLogEntry = { tick: number; heading: number; tasMs: number; altitudeM: number; note: string };

export type NavigatorState = {
    /** Счисленное место (ENU), м. */
    dr: { x: number; y: number };
    /** Оценка ветра (куда дует), м/с. */
    windEst: { x: number; y: number };
    legIndex: number;
    /** Курс, выданный пилоту, рад; и расчётное время прибытия на точку, с от начала. */
    courseToSteer: number | null;
    etaS: number | null;
    /** Требуемая приборная скорость для выхода на цель в окно времени, м/с. */
    requiredIasMs: number | null;
    fixes: number;
    corrections: number;
    lastDriftMeasureTick: number | null;
    lastFixTick: number | null;
    log: NavLogEntry[];
    /** Ошибка счисления на IP, м (метрика разбора). */
    errorAtIpM: number | null;
};

export function createNavigator(start: { x: number; y: number }, briefedWind: { x: number; y: number }): NavigatorState {
    return {
        dr: { ...start },
        windEst: { ...briefedWind },
        legIndex: 1,
        courseToSteer: null,
        etaS: null,
        requiredIasMs: null,
        fixes: 0,
        corrections: 0,
        lastDriftMeasureTick: null,
        lastFixTick: null,
        log: [],
        errorAtIpM: null,
    };
}

/** Счисление: курс по компасу и истинная скорость по прибору + оценка ветра. */
export function stepDeadReckoning(nav: NavigatorState, heading: number, tasMs: number, dt: number): void {
    nav.dr = {
        x: nav.dr.x + (Math.sin(heading) * tasMs + nav.windEst.x) * dt,
        y: nav.dr.y + (Math.cos(heading) * tasMs + nav.windEst.y) * dt,
    };
}

/**
 * Ветровой треугольник: по курсу, истинной скорости, измеренным сносу и путевой скорости — ветер.
 * Это то, что решает навигационный расчётник в интерфейсе штурмана.
 */
export function solveWind(heading: number, tasMs: number, driftRad: number, groundSpeedMs: number): { x: number; y: number } {
    const track = heading + driftRad;

    return {
        x: Math.sin(track) * groundSpeedMs - Math.sin(heading) * tasMs,
        y: Math.cos(track) * groundSpeedMs - Math.cos(heading) * tasMs,
    };
}

/** Курс, чтобы путь шёл на точку с учётом ветра, и путевая скорость. */
export function courseToSteer(from: { x: number; y: number }, to: { x: number; y: number }, tasMs: number, wind: { x: number; y: number }): { heading: number; groundSpeedMs: number } {
    const track = Math.atan2(to.x - from.x, to.y - from.y);
    // Боковая составляющая ветра относительно пути.
    const cross = wind.x * Math.cos(track) - wind.y * Math.sin(track);
    const along = wind.x * Math.sin(track) + wind.y * Math.cos(track);
    const wca = Math.asin(clamp(-cross / Math.max(tasMs, 1), -0.6, 0.6));

    return { heading: wrapPi(track + wca), groundSpeedMs: Math.max(tasMs * Math.cos(wca) + along, 1) };
}

/** Измерение сноса визиром: истинный снос + ошибка навыка/игрока. */
export function measureDrift(trueDrift: number, rng: Rng, sigmaRad: number): number {
    return trueDrift + rng.gaussian(0, sigmaRad);
}

/** Отметка по ориентиру: счисленное место подтягивается к истинному с ошибкой визуальной оценки. */
export function applyFix(nav: NavigatorState, truePosition: { x: number; y: number }, rng: Rng, sigmaM: number, tick: number): void {
    nav.dr = { x: truePosition.x + rng.gaussian(0, sigmaM), y: truePosition.y + rng.gaussian(0, sigmaM) };
    nav.fixes++;
    nav.lastFixTick = tick;
}

/** Пеленг радиокомпаса на приводную станцию (истинный, рад) с шумом. */
export function radioCompassBearing(from: { x: number; y: number }, beacon: { x: number; y: number }, rng: Rng, sigmaRad = 0.02): number {
    return wrapPi(Math.atan2(beacon.x - from.x, beacon.y - from.y) + rng.gaussian(0, sigmaRad));
}

/** Требуемая путевая скорость, чтобы прийти на точку к заданному времени. */
export function requiredGroundSpeed(distanceM: number, secondsLeft: number): number | null {
    return secondsLeft > 30 ? distanceM / secondsLeft : null;
}
