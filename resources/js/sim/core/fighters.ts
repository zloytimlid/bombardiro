import type { Bullet } from './ballistics';
import type { FightersConfig, FighterType, Skill } from './content';
import type { Vec3 } from './math';
import { add, clamp, cross, dot, length, normalize, scale, sub, vec } from './math';
import type { AttackType } from './mission/schema';
import type { Rng } from './rng';

/**
 * Истребители противника (раздел 8.4): точечная модель с ограничением скорости и разворота,
 * конечный автомат «патруль → обнаружение → сближение → заход → выход → повтор или уход».
 */
export type FighterPhase = 'patrol' | 'approach' | 'attack' | 'break' | 'leave' | 'down';

export type Fighter = {
    id: number;
    typeId: string;
    waveId: string;
    skill: Skill;
    position: Vec3;
    velocity: Vec3;
    hp: number;
    phase: FighterPhase;
    attacks: AttackType[];
    attackIndex: number;
    /** Сторона захода для атаки с борта: −1 слева, +1 справа. */
    side: number;
    passes: number;
    phaseS: number;
    reactionS: number;
    shotAccumulator: number;
    ammoS: number;
    firing: boolean;
    /** Кто нанёс последний урон (установка бомбардировщика) — для засчёта сбития. */
    lastHitBy: string | null;
    removed: boolean;
    closestRange: number;
};

export type FighterTarget = { position: Vec3; velocity: Vec3; inCloud: boolean };

export type FighterContext = {
    config: FightersConfig;
    type: FighterType;
    target: FighterTarget;
    groundAt: (x: number, y: number) => number;
    rng: Rng;
    dt: number;
    spawnBullet: (bullet: Omit<Bullet, 'id'>) => void;
};

const DETECT_RANGE_M = 9000;
const SETUP_RADIUS_M = 700;
const BREAK_RANGE_M = 200;
const BREAK_TIME_S = 7;
const LEAVE_RANGE_M = 9000;
const MAX_FIGHTER_BULLETS_PER_S = 12;

export function createFighter(id: number, type: FighterType, waveId: string, skill: Skill, position: Vec3, velocity: Vec3, attacks: AttackType[], side: number): Fighter {
    return {
        id,
        typeId: type.id,
        waveId,
        skill,
        position,
        velocity,
        hp: type.hp,
        phase: 'patrol',
        attacks,
        attackIndex: 0,
        side,
        passes: 0,
        phaseS: 0,
        reactionS: 0,
        shotAccumulator: 0,
        ammoS: type.ammo_s,
        firing: false,
        lastHitBy: null,
        removed: false,
        closestRange: Infinity,
    };
}

function setPhase(f: Fighter, phase: FighterPhase): void {
    f.phase = phase;
    f.phaseS = 0;
}

/** Точка построения захода относительно бомбардировщика. */
function setupPoint(f: Fighter, target: FighterTarget): Vec3 {
    const v = target.velocity;
    const fwd = normalize(vec(v.x, v.y, 0));
    const right = vec(fwd.y, -fwd.x, 0);
    const attack = f.attacks[f.attackIndex % f.attacks.length] ?? 'high_six';

    switch (attack) {
        case 'head_on':
            return add(add(target.position, scale(fwd, 4500)), vec(0, 0, 150));
        case 'beam':
            return add(add(add(target.position, scale(right, 2600 * f.side)), scale(fwd, 900)), vec(0, 0, 350));
        case 'high_six':
            return add(add(target.position, scale(fwd, -2200)), vec(0, 0, 700));
    }
}

/** Поворот вектора скорости к желаемому направлению с ограничением угловой скорости. */
function steer(f: Fighter, desiredDir: Vec3, desiredSpeed: number, type: FighterType, dt: number): void {
    const speed = Math.max(length(f.velocity), 1);
    const dir = scale(f.velocity, 1 / speed);
    const want = normalize(desiredDir);
    const maxTurn = ((type.max_turn_rate_deg_s * Math.PI) / 180) * dt;
    const angle = Math.acos(clamp(dot(dir, want), -1, 1));
    let next: Vec3;

    if (angle <= maxTurn || angle < 1e-6) {
        next = want;
    } else {
        // Поворот в плоскости (dir, want) на maxTurn.
        let axis = cross(dir, want);

        if (length(axis) < 1e-6) {
            axis = vec(0, 0, 1);
        }

        const k = normalize(axis);
        const cosT = Math.cos(maxTurn);
        const sinT = Math.sin(maxTurn);

        next = normalize(add(add(scale(dir, cosT), scale(cross(k, dir), sinT)), scale(k, dot(k, dir) * (1 - cosT))));
    }

    // Ограничение вертикальной скорости.
    const vz = clamp(next.z * speed, -type.max_climb_ms * 2.5, type.max_climb_ms);
    const newSpeed = speed + clamp(desiredSpeed - speed, -8 * dt, 6 * dt);

    f.velocity = scale(normalize(vec(next.x, next.y, vz / newSpeed)), newSpeed);
}

export function stepFighter(f: Fighter, ctx: FighterContext): void {
    const { type, target, dt } = ctx;
    const skill = ctx.config.skills[f.skill];
    const rel = sub(target.position, f.position);
    const range = length(rel);

    f.phaseS += dt;
    f.firing = false;
    f.closestRange = Math.min(f.closestRange, range);

    if (f.phase === 'down') {
        // Падает со снижением, пока не столкнётся с землёй.
        f.velocity = add(f.velocity, vec(0, 0, -9.8 * dt * 0.6));
        f.position = add(f.position, scale(f.velocity, dt));

        if (f.position.z <= ctx.groundAt(f.position.x, f.position.y)) {
            f.removed = true;
        }

        return;
    }

    if (f.hp <= 0) {
        setPhase(f, 'down');

        return;
    }

    let desired: Vec3 = f.velocity;
    let speed = type.cruise_speed_ms;

    switch (f.phase) {
        case 'patrol': {
            const detect = DETECT_RANGE_M * (target.inCloud ? 0.25 : 1);

            desired = vec(f.velocity.y, -f.velocity.x, 0); // вираж

            if (range < detect) {
                f.reactionS += dt;

                if (f.reactionS >= skill.reaction_s) {
                    setPhase(f, 'approach');
                }
            }
            break;
        }
        case 'approach': {
            const setup = setupPoint(f, target);
            const toSetup = sub(setup, f.position);

            desired = toSetup;
            speed = type.attack_speed_ms;

            if (length(toSetup) < SETUP_RADIUS_M || f.phaseS > 90) {
                setPhase(f, 'attack');
            }
            break;
        }
        case 'attack': {
            // Погоня с упреждением, огонь при совмещении носа с точкой упреждения.
            const relVel = sub(target.velocity, f.velocity);
            const tof = range / type.guns.muzzle_velocity_ms;
            const lead = add(rel, scale(target.velocity, tof));

            desired = lead;
            speed = type.attack_speed_ms;

            const nose = normalize(f.velocity);
            const offAngle = Math.acos(clamp(dot(nose, normalize(lead)), -1, 1));
            const closing = dot(rel, relVel) < 0;

            if (range < type.guns.range_m && offAngle < 0.045 && f.ammoS > 0) {
                fire(f, ctx, skill.aim_error_mrad);
            }

            if (range < BREAK_RANGE_M || (!closing && range < 700 && f.phaseS > 4) || f.phaseS > 45) {
                setPhase(f, 'break');
            }
            break;
        }
        case 'break': {
            // Выход из атаки: от цели и вниз/в сторону.
            const away = normalize(sub(f.position, target.position));

            desired = add(away, vec(0, 0, -0.35));
            speed = type.attack_speed_ms;

            if (f.phaseS > BREAK_TIME_S) {
                f.passes++;
                f.attackIndex++;
                f.side = -f.side;

                const exit = f.hp < type.hp * skill.exit_hp_share || f.passes >= skill.max_passes || f.ammoS <= 0;

                setPhase(f, exit ? 'leave' : 'approach');
            }
            break;
        }
        case 'leave': {
            desired = add(normalize(sub(f.position, target.position)), vec(0, 0, 0.05));
            speed = type.attack_speed_ms;

            if (range > LEAVE_RANGE_M) {
                f.removed = true;
            }
            break;
        }
    }

    steer(f, desired, speed, type, dt);
    f.position = add(f.position, scale(f.velocity, dt));

    // Не ниже 80 м над землёй.
    const floor = ctx.groundAt(f.position.x, f.position.y) + 80;

    if (f.position.z < floor) {
        f.position = { ...f.position, z: floor };
        f.velocity = { ...f.velocity, z: Math.max(f.velocity.z, 0) };
    }
}

function fire(f: Fighter, ctx: FighterContext, aimErrorMrad: number): void {
    const { type, dt, rng } = ctx;
    const roundsPerS = (type.guns.rate_rpm / 60) * type.guns.count;
    const bulletsPerS = Math.min(roundsPerS, MAX_FIGHTER_BULLETS_PER_S);
    const roundsPerBullet = roundsPerS / bulletsPerS;

    f.firing = true;
    f.ammoS -= dt;
    f.shotAccumulator += bulletsPerS * dt;

    const nose = normalize(f.velocity);
    const sigma = (aimErrorMrad + type.guns.dispersion_mrad) / 1000;

    while (f.shotAccumulator >= 1) {
        f.shotAccumulator -= 1;

        const dir = normalize(add(nose, vec(rng.gaussian(0, sigma), rng.gaussian(0, sigma), rng.gaussian(0, sigma))));

        ctx.spawnBullet({
            owner: f.id,
            mount: null,
            position: add(f.position, scale(nose, 4)),
            velocity: add(f.velocity, scale(dir, type.guns.muzzle_velocity_ms)),
            ageS: 0,
            tracer: true,
            damage: type.guns.damage_per_hit * roundsPerBullet,
        });
    }
}
