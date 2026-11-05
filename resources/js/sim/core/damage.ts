import type { AircraftState } from './aircraft';
import type { AircraftConfig, DamageZoneConfig, Station, SubsystemId, ZoneId } from './config';
import { SUBSYSTEMS, ZONES } from './config';
import type { CrewState } from './crew';
import { isActive, say, wound } from './crew';
import type { Vec3 } from './math';
import { clamp } from './math';
import type { Rng } from './rng';

/**
 * Модель повреждений (раздел 7.3): зоны планера с запасом прочности и привязанными подсистемами.
 * Пуля — рейкаст по коробкам зон; разрыв зенитного снаряда — число осколков по расстоянию,
 * распределённых по зонам пропорционально видимой площади.
 */
export type DamageState = {
    zoneHp: Record<ZoneId, number>;
    subsystemHp: Record<SubsystemId, number>;
    hits: Record<ZoneId, number>;
    /** Обратный отсчёт до заклинивания двигателя после пробития маслосистемы, с. */
    oilSeizeS: [number | null, number | null];
    /** Сколько горит двигатель, с (null — не горит). */
    engineFireS: [number | null, number | null];
    extinguishers: [boolean, boolean];
    wingFireS: [number | null, number | null];
    fuselageFire: boolean;
    wingDestroyed: [boolean, boolean];
    structuralFailure: boolean;
    generators: [boolean, boolean];
    cableCut: { rudder: boolean; elevator: boolean };
    /** Утечки, кг/с: «мелкие» затягивает протектор, «крупные» — нет. */
    smallLeaks: number[];
    bigLeaks: number[];
    lastHitTick: number | null;
};

export type DamageCause = 'bullet' | 'flak' | 'fire' | 'test';

export type DamageContext = {
    config: AircraftConfig;
    aircraft: AircraftState;
    crew: CrewState;
    rng: Rng;
    tick: number;
    event: (type: string, payload: Record<string, unknown>) => void;
};

const ENGINE_FIRE_SPREAD_S = 45;
const FUSELAGE_FIRE_HP_PER_S = 0.5;
const SMALL_LEAK_KG_S = 0.12;

export function createDamage(config: AircraftConfig): DamageState {
    const model = config.damage_model.value;
    const zoneHp = {} as Record<ZoneId, number>;
    const hits = {} as Record<ZoneId, number>;
    const subsystemHp = {} as Record<SubsystemId, number>;

    for (const id of ZONES) {
        zoneHp[id] = model.zones.find((z) => z.id === id)?.hp ?? 1;
        hits[id] = 0;
    }

    for (const id of SUBSYSTEMS) {
        subsystemHp[id] = model.subsystem_hp;
    }

    const tanks = config.fuel.gameplay_tanks.value.length;

    return {
        zoneHp,
        subsystemHp,
        hits,
        oilSeizeS: [null, null],
        engineFireS: [null, null],
        extinguishers: [true, true],
        wingFireS: [null, null],
        fuselageFire: false,
        wingDestroyed: [false, false],
        structuralFailure: false,
        generators: [true, true],
        cableCut: { rudder: false, elevator: false },
        smallLeaks: new Array<number>(tanks).fill(0),
        bigLeaks: new Array<number>(tanks).fill(0),
        lastHitTick: null,
    };
}

export const failed = (damage: DamageState, id: SubsystemId): boolean => damage.subsystemHp[id] <= 0;

const side = (id: string): 0 | 1 => (id.includes('left') ? 0 : 1);

function tankIndex(config: AircraftConfig, subsystem: SubsystemId): number {
    // tank_left_main → left_main
    const id = subsystem.replace(/^tank_/, '');

    return config.fuel.gameplay_tanks.value.findIndex((t) => t.id === id);
}

/** Попадание в зону: урон зоне, возможно — подсистеме и экипажу в ней. */
export function applyHit(ctx: DamageContext, damage: DamageState, zone: ZoneId, amount: number, cause: DamageCause): void {
    const model = ctx.config.damage_model.value;
    const zoneConfig = model.zones.find((z) => z.id === zone);

    if (zoneConfig === undefined || damage.structuralFailure) {
        return;
    }

    const before = damage.zoneHp[zone];

    damage.zoneHp[zone] = Math.max(0, before - amount);
    damage.hits[zone]++;
    damage.lastHitTick = ctx.tick;
    ctx.event('hit', { zone, amount, cause });

    // Подсистема в зоне.
    if (zoneConfig.subsystems.length > 0 && ctx.rng.chance(0.55)) {
        const sub = zoneConfig.subsystems[Math.floor(ctx.rng.next() * zoneConfig.subsystems.length)];

        if (sub !== undefined) {
            hitSubsystem(ctx, damage, sub, amount * 1.5);
        }
    }

    // Зональные эффекты.
    if (zone === 'engine_left' || zone === 'engine_right') {
        const i = side(zone);

        if (ctx.rng.chance(model.fire_chance_engine) && ctx.aircraft.engines[i].mode === 'running') {
            startEngineFire(ctx, damage, i);
        }
    } else if (zone === 'wing_left_inner' || zone === 'wing_right_inner' || zone === 'wing_left_outer' || zone === 'wing_right_outer') {
        const i = side(zone);
        const tank = zoneConfig.subsystems.find((s) => s.startsWith('tank_'));

        if (tank !== undefined && ctx.rng.chance(0.35)) {
            addLeak(ctx, damage, tank, false);
        }

        if (tank !== undefined && ctx.rng.chance(model.fire_chance_tank) && damage.wingFireS[i] === null) {
            damage.wingFireS[i] = 0;
            say(ctx.crew, ctx.tick, 'waist_gunner', 'intercom.wing_fire', { side: i === 0 ? 'left' : 'right' });
            ctx.event('fire', { where: `wing_${i === 0 ? 'left' : 'right'}` });
        }
    } else if (zone === 'fuselage_mid' && ctx.rng.chance(model.fire_chance_fuselage)) {
        startFuselageFire(ctx, damage);
    }

    // Экипаж в зоне.
    for (const station of zoneConfig.crew) {
        if (isActive(ctx.crew.members[station]) && ctx.rng.chance(model.wound_chance_per_hit * clamp(amount / 4, 0.25, 1))) {
            wound(ctx.crew, station, ctx.rng.chance(model.heavy_wound_share), ctx.tick);
            ctx.event('wound', { station });
        }
    }

    if (before > 0 && damage.zoneHp[zone] <= 0) {
        destroyZone(ctx, damage, zoneConfig);
    }
}

export function hitSubsystem(ctx: DamageContext, damage: DamageState, sub: SubsystemId, amount: number): void {
    const before = damage.subsystemHp[sub];

    damage.subsystemHp[sub] = Math.max(0, before - amount);

    if (sub.startsWith('tank_') && damage.subsystemHp[sub] > 0) {
        addLeak(ctx, damage, sub, false);
    }

    if (before > 0 && damage.subsystemHp[sub] <= 0) {
        destroySubsystem(ctx, damage, sub);
    }
}

function addLeak(ctx: DamageContext, damage: DamageState, tank: SubsystemId, big: boolean): void {
    const i = tankIndex(ctx.config, tank);

    if (i < 0) {
        return;
    }

    if (big) {
        damage.bigLeaks[i] = (damage.bigLeaks[i] ?? 0) + ctx.config.damage_model.value.tank_leak_kg_s;
    } else {
        damage.smallLeaks[i] = (damage.smallLeaks[i] ?? 0) + SMALL_LEAK_KG_S;
    }
}

export function startEngineFire(ctx: DamageContext, damage: DamageState, i: 0 | 1): void {
    if (damage.engineFireS[i] !== null) {
        return;
    }

    damage.engineFireS[i] = 0;
    ctx.aircraft.engines[i] = { ...ctx.aircraft.engines[i], fire: true };
    say(ctx.crew, ctx.tick, 'copilot', 'intercom.engine_fire', { side: i === 0 ? 'left' : 'right' });
    ctx.event('fire', { where: `engine_${i === 0 ? 'left' : 'right'}` });
}

export function startFuselageFire(ctx: DamageContext, damage: DamageState): void {
    if (!damage.fuselageFire) {
        damage.fuselageFire = true;
        say(ctx.crew, ctx.tick, 'top_gunner', 'intercom.fuselage_fire');
        ctx.event('fire', { where: 'fuselage' });
    }
}

function destroySubsystem(ctx: DamageContext, damage: DamageState, sub: SubsystemId): void {
    const model = ctx.config.damage_model.value;

    ctx.event('subsystem_destroyed', { subsystem: sub });

    switch (sub) {
        case 'oil_left':
        case 'oil_right': {
            const i = side(sub);

            damage.oilSeizeS[i] = model.oil_leak_seize_s;
            say(ctx.crew, ctx.tick, 'copilot', 'intercom.oil_pressure', { side: i === 0 ? 'left' : 'right' });
            break;
        }
        case 'generator_left':
        case 'generator_right':
            damage.generators[side(sub)] = false;
            break;
        case 'tank_left_main':
        case 'tank_right_main':
        case 'tank_left_aux':
        case 'tank_right_aux':
            addLeak(ctx, damage, sub, true);
            say(ctx.crew, ctx.tick, 'waist_gunner', 'intercom.fuel_leak', { side: sub.includes('left') ? 'left' : 'right' });
            break;
        case 'wiring':
            if (ctx.rng.chance(0.5)) {
                startFuselageFire(ctx, damage);
            }
            break;
        case 'control_cables':
            if (ctx.rng.chance(0.7)) {
                damage.cableCut.rudder = true;
                say(ctx.crew, ctx.tick, 'pilot', 'intercom.rudder_lost');
            } else {
                damage.cableCut.elevator = true;
                say(ctx.crew, ctx.tick, 'pilot', 'intercom.elevator_damaged');
            }
            break;
        case 'gear_struts':
        case 'tires':
            say(ctx.crew, ctx.tick, 'waist_gunner', 'intercom.gear_damaged');
            break;
        case 'bombsight':
            say(ctx.crew, ctx.tick, 'bombardier', 'intercom.sight_out');
            break;
        case 'radio':
            say(ctx.crew, ctx.tick, 'radio', 'intercom.radio_out');
            break;
        case 'turret':
            say(ctx.crew, ctx.tick, 'top_gunner', 'intercom.turret_out');
            break;
        case 'instruments':
            say(ctx.crew, ctx.tick, 'pilot', 'intercom.instruments_out');
            break;
        case 'bomb_bay':
            say(ctx.crew, ctx.tick, 'bombardier', 'intercom.doors_jammed');
            break;
        default:
            break;
    }
}

function destroyZone(ctx: DamageContext, damage: DamageState, zone: DamageZoneConfig): void {
    ctx.event('zone_destroyed', { zone: zone.id });

    for (const sub of zone.subsystems) {
        if (damage.subsystemHp[sub] > 0) {
            damage.subsystemHp[sub] = 0;
            destroySubsystem(ctx, damage, sub);
        }
    }

    switch (zone.id) {
        case 'engine_left':
        case 'engine_right': {
            const i = side(zone.id);

            ctx.aircraft.engineFailed = i === 0 ? [true, ctx.aircraft.engineFailed[1]] : [ctx.aircraft.engineFailed[0], true];
            say(ctx.crew, ctx.tick, 'copilot', 'intercom.engine_out', { side: i === 0 ? 'left' : 'right' });
            break;
        }
        case 'wing_left_inner':
        case 'wing_left_outer':
        case 'wing_right_inner':
        case 'wing_right_outer':
            damage.wingDestroyed[side(zone.id)] = true;
            break;
        case 'fuselage_mid':
        case 'fuselage_rear':
            damage.structuralFailure = true;
            break;
        default:
            break;
    }
}

/** Огнетушитель двигателя (второй пилот): одноразовый, надёжнее при зафлюгированном винте. */
export function extinguishEngine(ctx: DamageContext, damage: DamageState, i: 0 | 1): boolean {
    if (!damage.extinguishers[i]) {
        return false;
    }

    damage.extinguishers[i] = false;

    if (damage.engineFireS[i] === null) {
        return false;
    }

    const engine = ctx.aircraft.engines[i];
    const chance = engine.feathered ? 0.9 : 0.6;
    const success = ctx.rng.chance(chance);

    if (success) {
        damage.engineFireS[i] = null;
        ctx.aircraft.engines[i] = { ...engine, fire: false };
        say(ctx.crew, ctx.tick, 'copilot', 'intercom.fire_out', { side: i === 0 ? 'left' : 'right' });
        ctx.event('fire_out', { where: `engine_${i === 0 ? 'left' : 'right'}` });
    }

    return success;
}

export function extinguishFuselage(ctx: DamageContext, damage: DamageState): void {
    if (damage.fuselageFire) {
        damage.fuselageFire = false;
        say(ctx.crew, ctx.tick, 'top_gunner', 'intercom.fire_out', { side: 'fuselage' });
        ctx.event('fire_out', { where: 'fuselage' });
    }
}

/** Таймеры повреждений за тик и пересчёт модификаторов физики. */
export function stepDamage(ctx: DamageContext, damage: DamageState, dt: number): void {
    const model = ctx.config.damage_model.value;
    const aircraft = ctx.aircraft;

    for (const i of [0, 1] as const) {
        // Заклинивание после потери масла.
        const oil = damage.oilSeizeS[i];

        if (oil !== null && !aircraft.engineFailed[i] && aircraft.engines[i].mode === 'running') {
            const left = oil - dt;

            damage.oilSeizeS[i] = left;

            if (left <= 0) {
                aircraft.engineFailed = i === 0 ? [true, aircraft.engineFailed[1]] : [aircraft.engineFailed[0], true];
                damage.oilSeizeS[i] = null;
                say(ctx.crew, ctx.tick, 'copilot', 'intercom.engine_seized', { side: i === 0 ? 'left' : 'right' });
                ctx.event('engine_seized', { engine: i });
            }
        }

        // Пожар двигателя перекидывается на крыло.
        const fire = damage.engineFireS[i];

        if (fire !== null) {
            damage.engineFireS[i] = fire + dt;

            if (fire + dt > ENGINE_FIRE_SPREAD_S && damage.wingFireS[i] === null) {
                damage.wingFireS[i] = 0;
                ctx.event('fire', { where: `wing_${i === 0 ? 'left' : 'right'}` });
            }
        }

        // Непотушенный пожар крыла через таймер разрушает крыло (раздел 7.2).
        const wingFire = damage.wingFireS[i];

        if (wingFire !== null && !damage.wingDestroyed[i]) {
            damage.wingFireS[i] = wingFire + dt;

            if (wingFire + dt >= model.wing_fire_destruction_s) {
                damage.wingDestroyed[i] = true;
                ctx.event('wing_destroyed', { side: i });
            }
        }
    }

    if (damage.fuselageFire && !damage.structuralFailure) {
        damage.zoneHp.fuselage_mid = Math.max(0, damage.zoneHp.fuselage_mid - FUSELAGE_FIRE_HP_PER_S * dt);

        if (damage.zoneHp.fuselage_mid <= 0) {
            damage.structuralFailure = true;
            ctx.event('zone_destroyed', { zone: 'fuselage_mid' });
        }
    }

    // Протектированные баки затягивают мелкие пробоины.
    if (ctx.config.fuel.self_sealing) {
        const decay = Math.exp(-dt / model.self_sealing_tau_s);

        damage.smallLeaks = damage.smallLeaks.map((leak) => (leak <= model.self_sealing_max_leak_kg_s ? leak * decay : leak));
    }

    applyModifiers(ctx.config, damage, aircraft);
}

/** Состояние повреждений → модификаторы физики самолёта. */
export function applyModifiers(config: AircraftConfig, damage: DamageState, aircraft: AircraftState): void {
    const model = config.damage_model.value;
    const h = damage.hits;
    const wingHits = (a: ZoneId, b: ZoneId): number => h[a] + h[b];
    const liftLoss = (i: 0 | 1): number =>
        damage.wingDestroyed[i]
            ? 1
            : clamp(model.lift_loss_per_hit * (i === 0 ? wingHits('wing_left_inner', 'wing_left_outer') : wingHits('wing_right_inner', 'wing_right_outer')), 0, 0.45);
    const enginePower = (i: 0 | 1): number => {
        const zone: ZoneId = i === 0 ? 'engine_left' : 'engine_right';
        const prop: SubsystemId = i === 0 ? 'prop_left' : 'prop_right';

        return clamp(1 - model.power_loss_per_hit * h[zone] - (failed(damage, prop) ? 0.3 : 0), 0.1, 1);
    };
    const tailControl = clamp(1 - model.control_loss_per_hit * 0.5 * h.tail, 0.3, 1);
    const totalHits = ZONES.reduce((sum, z) => sum + h[z], 0);

    aircraft.modifiers = {
        elevator: damage.cableCut.elevator || failed(damage, 'elevator') ? 0.3 : tailControl,
        aileronLeft: damage.wingDestroyed[0] || failed(damage, 'aileron_left') ? 0 : 1,
        aileronRight: damage.wingDestroyed[1] || failed(damage, 'aileron_right') ? 0 : 1,
        rudder: damage.cableCut.rudder ? 0 : failed(damage, 'rudder') ? 0.3 : tailControl,
        liftLoss: damage.structuralFailure ? [1, 1] : [liftLoss(0), liftLoss(1)],
        extraCd: model.drag_per_hit * totalHits,
        enginePower: [enginePower(0), enginePower(1)],
        fuelLeakKgS: damage.smallLeaks.map((s, i) => s + (damage.bigLeaks[i] ?? 0)),
        gearFailed: failed(damage, 'gear_struts'),
        manualGearDown: aircraft.modifiers.manualGearDown,
        hydraulicPumps: [!failed(damage, 'hydraulic_pump_left'), !failed(damage, 'hydraulic_pump_right')],
        bayDoorsJammed: failed(damage, 'bomb_bay'),
        flapsJammed: failed(damage, 'flaps'),
    };
}

/** Пересечение луча с коробкой (slab method). Возвращает расстояние входа или null. */
export function rayBox(origin: Vec3, dir: Vec3, box: readonly [readonly number[], readonly number[]], maxT: number): number | null {
    let tMin = 0;
    let tMax = maxT;
    const o = [origin.x, origin.y, origin.z];
    const d = [dir.x, dir.y, dir.z];

    for (let axis = 0; axis < 3; axis++) {
        const lo = box[0][axis] ?? 0;
        const hi = box[1][axis] ?? 0;
        const oa = o[axis] ?? 0;
        const da = d[axis] ?? 0;

        if (Math.abs(da) < 1e-9) {
            if (oa < lo || oa > hi) {
                return null;
            }
        } else {
            let t1 = (lo - oa) / da;
            let t2 = (hi - oa) / da;

            if (t1 > t2) {
                [t1, t2] = [t2, t1];
            }

            tMin = Math.max(tMin, t1);
            tMax = Math.min(tMax, t2);

            if (tMin > tMax) {
                return null;
            }
        }
    }

    return tMin;
}

/** Первая зона на отрезке (в связанных осях): origin + dir·t, t ∈ [0, length]. */
export function raycastZones(config: AircraftConfig, origin: Vec3, dir: Vec3, length: number): ZoneId | null {
    let best: ZoneId | null = null;
    let bestT = Infinity;

    for (const zone of config.damage_model.value.zones) {
        const t = rayBox(origin, dir, zone.box_m, length);

        if (t !== null && t < bestT) {
            bestT = t;
            best = zone.id;
        }
    }

    return best;
}

/** Видимая площадь зон с направления `dirBody` (единичный, в связанных осях) — веса для осколков. */
export function zoneWeights(config: AircraftConfig, dirBody: Vec3): { zone: ZoneId; weight: number }[] {
    return config.damage_model.value.zones.map((zone) => {
        const [lo, hi] = zone.box_m;
        const sx = hi[0] - lo[0];
        const sy = hi[1] - lo[1];
        const sz = hi[2] - lo[2];

        return { zone: zone.id, weight: Math.abs(dirBody.x) * sy * sz + Math.abs(dirBody.y) * sx * sz + Math.abs(dirBody.z) * sx * sy };
    });
}

export function pickWeighted<T extends { weight: number }>(items: T[], rng: Rng): T | undefined {
    const total = items.reduce((s, i) => s + i.weight, 0);
    let r = rng.next() * total;

    for (const item of items) {
        r -= item.weight;

        if (r <= 0) {
            return item;
        }
    }

    return items[items.length - 1];
}

/** Члены экипажа, способные работать на станции (для ИИ и интерфейса). */
export function stationEquipmentOk(damage: DamageState, station: Station): boolean {
    switch (station) {
        case 'bombardier':
            return !failed(damage, 'nose_gun');
        case 'top_gunner':
            return !failed(damage, 'turret');
        case 'radio':
        case 'waist_gunner':
            return !failed(damage, 'waist_guns');
        case 'tail_gunner':
            return !failed(damage, 'tail_gun');
        default:
            return true;
    }
}
