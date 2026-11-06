import type { WeatherConfig } from './atmosphere';
import { GRAVITY, isa, windAt } from './atmosphere';
import type { BombType } from './content';
import type { Vec3 } from './math';
import { add, length, scale, sub, vec } from './math';

/**
 * Баллистика 12,7 мм и авиабомб (разделы 6.4, 6.6). Пули: dv/dt = −k·|v|·v + g (k — на метр пути).
 * Бомбы: сопротивление ½ρCdA·|v_возд|·v_возд, ветер сносит бомбу вместе с воздушной массой.
 */
export type Bullet = {
    id: number;
    /** 'bomber' — пулемёты бомбардировщика, иначе id истребителя. */
    owner: 'bomber' | number;
    mount: string | null;
    position: Vec3;
    velocity: Vec3;
    ageS: number;
    tracer: boolean;
    damage: number;
    /** Компенсация задержки стрелка: на сколько тиков откатить цели при проверке попадания (раздел 9.1). */
    lagTicks?: number;
};

export function stepBullet(bullet: Bullet, dragKPerM: number, dt: number): { from: Vec3; to: Vec3 } {
    const from = bullet.position;
    const speed = length(bullet.velocity);
    const accel = add(scale(bullet.velocity, -dragKPerM * speed), vec(0, 0, -GRAVITY));

    bullet.velocity = add(bullet.velocity, scale(accel, dt));
    bullet.position = add(from, scale(bullet.velocity, dt));
    bullet.ageS += dt;

    return { from, to: bullet.position };
}

/** Пересечение отрезка со сферой: параметр 0..1 первой точки входа или null. */
export function segmentSphere(from: Vec3, to: Vec3, center: Vec3, radius: number): number | null {
    const d = sub(to, from);
    const f = sub(from, center);
    const a = d.x * d.x + d.y * d.y + d.z * d.z;
    const b = 2 * (f.x * d.x + f.y * d.y + f.z * d.z);
    const c = f.x * f.x + f.y * f.y + f.z * f.z - radius * radius;

    if (c <= 0) {
        return 0;
    }

    if (a < 1e-12) {
        return null;
    }

    const disc = b * b - 4 * a * c;

    if (disc < 0) {
        return null;
    }

    const t = (-b - Math.sqrt(disc)) / (2 * a);

    return t >= 0 && t <= 1 ? t : null;
}

export type FallingBomb = {
    id: number;
    typeId: string;
    position: Vec3;
    velocity: Vec3;
    armed: boolean;
    releasedTick: number;
    /** Точка прицеливания на момент сброса (для промаха в разборе). */
    aimPoint: Vec3;
};

export function bombDragFactor(type: BombType): number {
    const g = type.gameplay.value;
    const area = Math.PI * (g.diameter_m / 2) ** 2;

    return (0.5 * g.cd * area) / type.mass_kg.value;
}

export function stepBomb(bomb: FallingBomb, type: BombType, weather: WeatherConfig, dt: number): void {
    const k = bombDragFactor(type);
    const rho = isa(bomb.position.z).density;
    const air = sub(bomb.velocity, windAt(weather, bomb.position.z));
    const speed = length(air);
    const accel = add(scale(air, -k * rho * speed), vec(0, 0, -GRAVITY));

    bomb.velocity = add(bomb.velocity, scale(accel, dt));
    bomb.position = add(bomb.position, scale(bomb.velocity, dt));
}

/**
 * Время падения и отставание (trail) бомбы в штиль: сброс горизонтально со скоростью `tas`
 * с высоты `dropAltitude` (над уровнем моря) на цель высотой `targetElevation`.
 * trail — насколько бомба отстаёт от проекции самолёта к моменту удара, м.
 */
export function fallSolution(type: BombType, dropAltitude: number, targetElevation: number, tas: number, dt = 0.02): { timeS: number; trailM: number } {
    const k = bombDragFactor(type);
    let z = dropAltitude;
    let x = 0;
    let vx = tas;
    let vz = 0;
    let t = 0;

    while (z > targetElevation && t < 200) {
        const rho = isa(z).density;
        const speed = Math.hypot(vx, vz);
        const ax = -k * rho * speed * vx;
        const az = -k * rho * speed * vz - GRAVITY;
        const stepDt = Math.min(dt, vz < 0 ? (z - targetElevation) / -vz : dt);

        vx += ax * stepDt;
        vz += az * stepDt;
        x += vx * stepDt;
        z += vz * stepDt;
        t += stepDt;

        if (stepDt < dt * 0.5 && z - targetElevation < 1e-3) {
            break;
        }
    }

    return { timeS: t, trailM: tas * t - x };
}

/**
 * Баллистическая таблица прицела для типа бомбы: время падения и отставание по сетке
 * высот над целью и истинных скоростей (раздел 6.4: «баллистика бомбы из таблицы»).
 */
export type BallisticTable = {
    typeId: string;
    heights: number[];
    speeds: number[];
    /** [i высоты][j скорости] */
    time: number[][];
    trail: number[][];
};

export function buildBallisticTable(type: BombType, targetElevation = 0): BallisticTable {
    const heights = [500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 6000, 7000];
    const speeds = [70, 80, 90, 100, 110, 120, 130];
    const time: number[][] = [];
    const trail: number[][] = [];

    for (const h of heights) {
        const tRow: number[] = [];
        const trRow: number[] = [];

        for (const v of speeds) {
            const s = fallSolution(type, targetElevation + h, targetElevation, v, 0.05);

            tRow.push(s.timeS);
            trRow.push(s.trailM);
        }

        time.push(tRow);
        trail.push(trRow);
    }

    return { typeId: type.id, heights, speeds, time, trail };
}

function bracket(values: number[], x: number): { i: number; f: number } {
    if (x <= (values[0] ?? 0)) {
        return { i: 0, f: 0 };
    }

    for (let i = 0; i < values.length - 1; i++) {
        const a = values[i] ?? 0;
        const b = values[i + 1] ?? 0;

        if (x <= b) {
            return { i, f: (x - a) / (b - a) };
        }
    }

    return { i: values.length - 2, f: 1 };
}

export function lookupBallistics(table: BallisticTable, height: number, tas: number): { timeS: number; trailM: number } {
    const h = bracket(table.heights, height);
    const v = bracket(table.speeds, tas);
    const at = (grid: number[][], i: number, j: number): number => grid[i]?.[j] ?? 0;
    const bilinear = (grid: number[][]): number => {
        const a = at(grid, h.i, v.i) * (1 - v.f) + at(grid, h.i, v.i + 1) * v.f;
        const b = at(grid, h.i + 1, v.i) * (1 - v.f) + at(grid, h.i + 1, v.i + 1) * v.f;

        return a * (1 - h.f) + b * h.f;
    };

    return { timeS: bilinear(table.time), trailM: bilinear(table.trail) };
}
