import type { AircraftState } from './aircraft';
import type { Bullet } from './ballistics';
import type { AircraftConfig, MountConfig, Station } from './config';
import type { GunConfig } from './content';
import type { Vec3 } from './math';
import { add, clamp, moveTowards, normalize, rotate, scale, vec, wrapPi } from './math';
import type { Rng } from './rng';

/**
 * Пулемётные установки бомбардировщика (раздел 6.6): сектора и скорость поворота,
 * зоны запрета огня по своему планеру, трассеры, конечный боезапас, перегрев и задержки.
 */
export type MountState = {
    id: string;
    station: Station;
    guns: number;
    fixed: boolean;
    /** Текущее направление ствола в связанных осях: азимут от носа (+ вправо), угол места (+ вверх), рад. */
    az: number;
    el: number;
    ammo: number;
    heat: number;
    jammed: boolean;
    clearHoldS: number;
    shotAccumulator: number;
    shotsFired: number;
    hits: number;
    roundCounter: number;
    disabled: boolean;
    /** Огонь открыт в этом тике (для звука и вспышки). */
    firing: boolean;
};

export type MountCommand = {
    /** Желаемое направление; установка доворачивает со своей скоростью. */
    az?: number;
    el?: number;
    fire: boolean;
    clearJam: boolean;
};

const DEG = Math.PI / 180;

export function createMounts(config: AircraftConfig, gun: GunConfig): MountState[] {
    const mounts = config.gameplay_mounts.value;

    return config.guns.map((g) => {
        const m = mounts[g.id];
        const fixed = g.mount === 'fixed';

        return {
            id: g.id,
            station: g.station,
            guns: g.count,
            fixed,
            az: (m?.az_center_deg ?? 0) * DEG,
            el: 0,
            ammo: g.count * gun.gameplay.value.ammo_per_gun,
            heat: 0,
            jammed: false,
            clearHoldS: 0,
            shotAccumulator: 0,
            shotsFired: 0,
            hits: 0,
            roundCounter: 0,
            disabled: false,
            firing: false,
        };
    });
}

/** Ограничение направления сектором установки. */
export function clampToArc(mount: MountConfig, az: number, el: number): { az: number; el: number } {
    const center = mount.az_center_deg * DEG;
    const half = mount.az_half_deg * DEG;
    const rel = clamp(wrapPi(az - center), -half, half);

    return { az: wrapPi(center + rel), el: clamp(el, mount.el_deg[0] * DEG, mount.el_deg[1] * DEG) };
}

/** Зона запрета огня по своему планеру (хвостовое оперение, кабина). */
export function inNoFireZone(mount: MountConfig, az: number, el: number): boolean {
    return mount.no_fire.some((z) => Math.abs(wrapPi(az - z.az_center_deg * DEG)) <= z.az_half_deg * DEG && el <= z.el_max_deg * DEG);
}

export function mountDirectionBody(az: number, el: number): Vec3 {
    // FRD: x вперёд, y вправо, z вниз; угол места вверх → −z.
    return vec(Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), -Math.sin(el));
}

export function stepMount(
    mount: MountState,
    mountConfig: MountConfig,
    command: MountCommand,
    gun: GunConfig,
    aircraft: AircraftState,
    rng: Rng,
    dt: number,
    spawn: (bullet: Omit<Bullet, 'id'>) => void,
    efficiency = 1,
): void {
    const g = gun.gameplay.value;

    mount.firing = false;

    // Наведение со скоростью установки; раненый стрелок поворачивает медленнее.
    if (!mount.fixed && command.az !== undefined && command.el !== undefined) {
        const target = clampToArc(mountConfig, command.az, command.el);
        const rate = mountConfig.slew_deg_s * DEG * dt * (0.4 + 0.6 * efficiency);

        mount.az = wrapPi(mount.az + clamp(wrapPi(target.az - mount.az), -rate, rate));
        mount.el = moveTowards(mount.el, target.el, rate);
    }

    // Остывание ствола.
    mount.heat = Math.max(0, mount.heat - g.cool_per_s * dt);

    // Устранение задержки — удержание клавиши.
    if (mount.jammed) {
        mount.clearHoldS = command.clearJam ? mount.clearHoldS + dt : 0;

        if (mount.clearHoldS >= g.clear_jam_hold_s / Math.max(efficiency, 0.3)) {
            mount.jammed = false;
            mount.clearHoldS = 0;
        }

        return;
    }

    if (!command.fire || mount.disabled || mount.ammo <= 0 || inNoFireZone(mountConfig, mount.az, mount.el)) {
        mount.shotAccumulator = 0;

        return;
    }

    mount.firing = true;
    mount.shotAccumulator += (gun.rate_rpm.value / 60) * mount.guns * dt;

    const dirBody = mountDirectionBody(mount.az, mount.el);
    const origin = add(aircraft.position, rotate(aircraft.attitude, vec(...mountConfig.position_m)));

    while (mount.shotAccumulator >= 1 && mount.ammo > 0) {
        mount.shotAccumulator -= 1;
        mount.ammo--;
        mount.shotsFired++;
        mount.roundCounter++;
        mount.heat = Math.min(1, mount.heat + g.heat_per_shot / mount.guns);

        const jamChance = mount.heat > g.overheat ? g.jam_chance_per_shot_overheated : g.jam_chance_per_shot;

        if (rng.chance(jamChance)) {
            mount.jammed = true;
            mount.shotAccumulator = 0;

            break;
        }

        const spread = (g.dispersion_mrad / 1000) * (1.5 - 0.5 * efficiency);
        const dir = normalize(add(dirBody, vec(0, rng.gaussian(0, spread), rng.gaussian(0, spread))));
        const dirWorld = rotate(aircraft.attitude, dir);

        spawn({
            owner: 'bomber',
            mount: mount.id,
            position: origin,
            velocity: add(aircraft.velocity, scale(dirWorld, gun.muzzle_velocity_ms.value)),
            ageS: 0,
            tracer: mount.roundCounter % g.tracer_every === 0,
            damage: g.damage_per_hit,
        });
    }
}

/**
 * Упреждение: направление (в мировых осях) для попадания по цели, движущейся с постоянной скоростью.
 * Решение уравнения встречи |p + v·t| = s·t относительно стрелка.
 */
export function leadDirection(relPosition: Vec3, relVelocity: Vec3, bulletSpeed: number): { dir: Vec3; timeS: number } | null {
    const a = relVelocity.x ** 2 + relVelocity.y ** 2 + relVelocity.z ** 2 - bulletSpeed ** 2;
    const b = 2 * (relPosition.x * relVelocity.x + relPosition.y * relVelocity.y + relPosition.z * relVelocity.z);
    const c = relPosition.x ** 2 + relPosition.y ** 2 + relPosition.z ** 2;
    let t: number;

    if (Math.abs(a) < 1e-6) {
        t = -c / b;
    } else {
        const disc = b * b - 4 * a * c;

        if (disc < 0) {
            return null;
        }

        const r1 = (-b - Math.sqrt(disc)) / (2 * a);
        const r2 = (-b + Math.sqrt(disc)) / (2 * a);

        t = Math.min(r1, r2) > 0 ? Math.min(r1, r2) : Math.max(r1, r2);
    }

    if (!(t > 0)) {
        return null;
    }

    return { dir: normalize(add(relPosition, scale(relVelocity, t))), timeS: t };
}

/** Азимут и угол места направления в связанных осях. */
export function azElOf(dirBody: Vec3): { az: number; el: number } {
    return { az: Math.atan2(dirBody.y, dirBody.x), el: Math.atan2(-dirBody.z, Math.hypot(dirBody.x, dirBody.y)) };
}
