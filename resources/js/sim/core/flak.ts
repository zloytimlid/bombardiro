import type { FlakType } from './content';
import type { Vec3 } from './math';
import { add, length, scale, sub, vec, wrapPi } from './math';
import type { Rng } from './rng';

/**
 * Зенитная артиллерия (раздел 8.4). Снаряды не симулируются: батарея считает упреждённую точку,
 * разрыв происходит через время полёта. Ошибка уменьшается, пока цель держит прямой курс,
 * и сбрасывается при манёвре — ключевой конфликт «маневрировать до IP, держать курс после».
 */
export type FlakBattery = {
    id: string;
    typeId: 'heavy' | 'light';
    position: Vec3;
    guns: number;
    active: boolean;
    barrage: boolean;
    cooldownS: number;
    trackingS: number;
    /** Курс и высота цели при последней оценке манёвра. */
    refHeading: number | null;
    refAltitude: number | null;
    refTimerS: number;
    shots: number;
};

export type FlakBurst = {
    id: number;
    batteryId: string;
    typeId: 'heavy' | 'light';
    position: Vec3;
    /** Тик разрыва (до него снаряд «в полёте»). */
    tick: number;
    resolved: boolean;
};

export type FlakTarget = { position: Vec3; velocity: Vec3; heading: number };

const MANEUVER_WINDOW_S = 4;

export function errorFor(type: FlakType, trackingS: number): number {
    const k = Math.min(trackingS / type.tracking_time_s, 1);

    return type.base_error_m + (type.min_error_m - type.base_error_m) * k;
}

/** Обновляет сопровождение и выпускает снаряды; возвращает новые разрывы. */
export function stepBattery(
    battery: FlakBattery,
    type: FlakType,
    target: FlakTarget,
    barrageCenter: Vec3 | null,
    rng: Rng,
    tick: number,
    tickHz: number,
    dt: number,
    nextId: () => number,
): FlakBurst[] {
    if (!battery.active) {
        return [];
    }

    const rel = sub(target.position, battery.position);
    const range = length(rel);
    const altitudeAboveBattery = rel.z;

    if (range > type.max_range_m || altitudeAboveBattery > type.max_altitude_m || altitudeAboveBattery < 30) {
        battery.trackingS = 0;
        battery.refHeading = null;

        return [];
    }

    // Сопровождение: прямой курс накапливает точность, манёвр сбрасывает.
    battery.trackingS += dt;
    battery.refTimerS += dt;

    if (battery.refHeading === null || battery.refAltitude === null) {
        battery.refHeading = target.heading;
        battery.refAltitude = target.position.z;
        battery.refTimerS = 0;
    } else if (battery.refTimerS >= MANEUVER_WINDOW_S) {
        const turned = Math.abs(wrapPi(target.heading - battery.refHeading)) * (180 / Math.PI) > type.maneuver_heading_deg;
        const climbed = Math.abs(target.position.z - battery.refAltitude) > type.maneuver_altitude_m;

        if (turned || climbed) {
            battery.trackingS = 0;
        }

        battery.refHeading = target.heading;
        battery.refAltitude = target.position.z;
        battery.refTimerS = 0;
    }

    battery.cooldownS -= dt;

    if (battery.cooldownS > 0) {
        return [];
    }

    battery.cooldownS = type.interval_s;

    const tof = range / type.shell_speed_ms;
    const bursts: FlakBurst[] = [];
    const sigma = errorFor(type, battery.trackingS);

    for (let g = 0; g < battery.guns; g++) {
        let point: Vec3;

        if (battery.barrage && barrageCenter !== null && type.barrage_box_m > 0) {
            // Заградительный огонь по квадрату на высоте цели.
            const box = type.barrage_box_m;

            point = add(barrageCenter, vec(rng.range(-box, box), rng.range(-box, box), target.position.z - barrageCenter.z + rng.gaussian(0, 60)));
        } else {
            const predicted = add(target.position, scale(target.velocity, tof));

            point = add(predicted, vec(rng.gaussian(0, sigma), rng.gaussian(0, sigma), rng.gaussian(0, sigma * 0.6)));
        }

        bursts.push({ id: nextId(), batteryId: battery.id, typeId: battery.typeId, position: point, tick: tick + Math.max(1, Math.round(tof * tickHz)), resolved: false });
        battery.shots++;
    }

    return bursts;
}

/** Ожидаемое число осколков, попавших в самолёт, от разрыва на расстоянии d. */
export function expectedFragments(type: FlakType, distance: number): number {
    if (distance > type.lethal_radius_m) {
        return 0;
    }

    return type.fragments_at_10m * (10 / Math.max(distance, 4)) ** 2;
}

/** Пуассоновская выборка (алгоритм Кнута, λ обычно мала). */
export function poisson(rng: Rng, lambda: number): number {
    if (lambda <= 0) {
        return 0;
    }

    if (lambda > 30) {
        return Math.max(0, Math.round(rng.gaussian(lambda, Math.sqrt(lambda))));
    }

    const limit = Math.exp(-lambda);
    let k = 0;
    let p = 1;

    do {
        k++;
        p *= rng.next();
    } while (p > limit);

    return k - 1;
}
