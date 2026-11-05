import type { BallisticTable } from './ballistics';
import { lookupBallistics } from './ballistics';
import { clamp, wrapPi } from './math';

/**
 * Игровая модель гиростабилизированного тахометрического прицела (раздел 6.4).
 * Прицел хранит оценку вектора «самолёт → точка прицеливания» и смещает её со скоростью,
 * заданной ручками «скорость» (путевая скорость) и «снос». Если оценки верны, цель стоит
 * в перекрестье. Сброс — автоматически, когда дальность до точки равна Vп·T − отставание.
 * Конкретный тип прицела на 43-4064 — TODO(history).
 */
export type BombsightState = {
    on: boolean;
    failed: boolean;
    /** Ввод: высота над целью, м; истинная скорость, м/с. */
    altitudeSetM: number;
    tasSetMs: number;
    /** Ручки синхронизации: путевая скорость, м/с; угол сноса, рад. */
    rateMs: number;
    driftRad: number;
    /** Оценка горизонтального вектора к точке прицеливания (ENU), м. */
    aim: { x: number; y: number } | null;
    mode: 'salvo' | 'train';
    intervalMs: number;
    armed: boolean;
    autoRelease: boolean;
    releasing: boolean;
};

export function createBombsight(): BombsightState {
    return {
        on: false,
        failed: false,
        altitudeSetM: 3000,
        tasSetMs: 95,
        rateMs: 95,
        driftRad: 0,
        aim: null,
        mode: 'train',
        intervalMs: 120,
        armed: false,
        autoRelease: true,
        releasing: false,
    };
}

/** Направление пути по оценке прицела: курс + снос. */
export const estimatedTrack = (sight: BombsightState, heading: number): number => heading + sight.driftRad;

/** Включение прицела: перекрестье ставится вперёд по пути на заданную дальность. */
export function activateSight(sight: BombsightState, heading: number, rangeM: number): void {
    const track = estimatedTrack(sight, heading);

    sight.on = true;
    sight.aim = { x: Math.sin(track) * rangeM, y: Math.cos(track) * rangeM };
}

export function stepBombsight(sight: BombsightState, heading: number, dt: number): void {
    if (!sight.on || sight.aim === null) {
        return;
    }

    const track = estimatedTrack(sight, heading);

    sight.aim = { x: sight.aim.x - Math.sin(track) * sight.rateMs * dt, y: sight.aim.y - Math.cos(track) * sight.rateMs * dt };
}

/** Перемещение перекрестья: вдоль пути и поперёк (вправо), м. */
export function nudgeCrosshair(sight: BombsightState, heading: number, along: number, across: number): void {
    if (sight.aim === null) {
        return;
    }

    const track = estimatedTrack(sight, heading);

    sight.aim = {
        x: sight.aim.x + Math.sin(track) * along + Math.cos(track) * across,
        y: sight.aim.y + Math.cos(track) * along - Math.sin(track) * across,
    };
}

/** Разложение горизонтального вектора по пути прицела. */
export function toTrackFrame(v: { x: number; y: number }, track: number): { along: number; across: number } {
    return { along: v.x * Math.sin(track) + v.y * Math.cos(track), across: v.x * Math.cos(track) - v.y * Math.sin(track) };
}

/** Дальность сброса по оценкам прицела: Vп·T − отставание. */
export function releaseRange(sight: BombsightState, table: BallisticTable): { rangeM: number; timeS: number } {
    const fall = lookupBallistics(table, sight.altitudeSetM, sight.tasSetMs);

    return { rangeM: sight.rateMs * fall.timeS - fall.trailM, timeS: fall.timeS };
}

export type SightReadout = {
    /** Угол визирования и угол сброса от вертикали, рад. */
    sightAngle: number;
    dropAngle: number;
    /** Смещение цели относительно перекрестья в поле зрения (вдоль/поперёк пути), м на земле. */
    error: { along: number; across: number } | null;
    /** Указатель PDI: + — довернуть вправо, рад. */
    pdi: number;
    /** Сколько секунд до сброса по оценкам прицела. */
    secondsToRelease: number | null;
};

export function readSight(
    sight: BombsightState,
    table: BallisticTable,
    heading: number,
    toTarget: { x: number; y: number } | null,
    trainSpreadM = 0,
): SightReadout {
    if (!sight.on || sight.aim === null) {
        return { sightAngle: 0, dropAngle: 0, error: null, pdi: 0, secondsToRelease: null };
    }

    const track = estimatedTrack(sight, heading);
    const aim = toTrackFrame(sight.aim, track);
    const range = releaseRange(sight, table);
    const error = toTarget === null ? null : toTrackFrame({ x: toTarget.x - sight.aim.x, y: toTarget.y - sight.aim.y }, track);
    // Телескоп повёрнут на точку прицеливания; разница с путём — отклонение стрелки PDI.
    const pdi = clamp(wrapPi(Math.atan2(aim.across, Math.max(aim.along, 1))), -0.35, 0.35);

    return {
        sightAngle: Math.atan2(aim.along, sight.altitudeSetM),
        dropAngle: Math.atan2(range.rangeM, sight.altitudeSetM),
        error,
        pdi,
        secondsToRelease: sight.rateMs > 1 ? (aim.along - range.rangeM - trainSpreadM) / sight.rateMs : null,
    };
}

/** Пора ли начинать сброс (для серии — раньше на половину её длины). */
export function shouldRelease(sight: BombsightState, table: BallisticTable, heading: number, trainSpreadM: number): boolean {
    if (!sight.on || sight.aim === null || sight.failed || !sight.autoRelease) {
        return false;
    }

    const aim = toTrackFrame(sight.aim, estimatedTrack(sight, heading));

    return aim.along > 0 && aim.along <= releaseRange(sight, table).rangeM + trainSpreadM;
}

/** Идеальная синхронизация (для юнит-теста баллистики и демонстрации): оценки = истина. */
export function syncPerfect(
    sight: BombsightState,
    truth: { heightAboveTarget: number; tas: number; groundVelocity: { x: number; y: number }; heading: number; toTarget: { x: number; y: number } },
): void {
    const gs = Math.hypot(truth.groundVelocity.x, truth.groundVelocity.y);
    const track = Math.atan2(truth.groundVelocity.x, truth.groundVelocity.y);

    sight.on = true;
    sight.altitudeSetM = truth.heightAboveTarget;
    sight.tasSetMs = truth.tas;
    sight.rateMs = gs;
    sight.driftRad = wrapPi(track - truth.heading);
    sight.aim = { ...truth.toTarget };
}
