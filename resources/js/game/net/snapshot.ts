import type { AircraftConfig, AircraftModifiers, AircraftState, ChecklistId, CrewTaskKind, EngineMode, GroundContact, Health, MissionWorld, Station, Terrain, WeatherConfig, ZoneId } from '@/sim/core';
import { CHECKLISTS, derive, STATIONS, ZONES } from '@/sim/core';
import type { WorldView } from '@/sim/view';
import { buildView } from '@/sim/view';
import type { SnapMsg } from './schemas';
import { PROTOCOL_VERSION } from './schemas';

/**
 * Снапшот client-snap ≤ 4 КБ (раздел 9.2): короткие ключи, квантование (позиция до 1 см,
 * углы до 10⁻⁴ рад), ключевой кадр раз в секунду (полное медленное состояние), между ними —
 * только быстрая часть (самолёт, истребители, установки, снаряды).
 */
const CONTACTS: GroundContact[] = ['air', 'gear', 'belly', 'water', 'crashed'];
const MODES: EngineMode[] = ['off', 'cranking', 'running', 'failed'];
const FIGHTER_PHASES = ['patrol', 'approach', 'attack', 'break', 'leave', 'down'];
const FLAK = ['heavy', 'light'];
const MAX_TRACERS = 16;

const cm = (v: number): number => Math.round(v * 100);
const dm = (v: number): number => Math.round(v * 10);
const e4 = (v: number): number => Math.round(v * 1e4);
const e3 = (v: number): number => Math.round(v * 1e3);
const b = (v: boolean): number => (v ? 1 : 0);

const HEALTH: Health[] = ['ok', 'wounded', 'incapacitated'];
const TASKS: (CrewTaskKind | null)[] = [null, 'extinguish', 'first_aid', 'emergency_gear', 'fuel_transfer'];
const CHECKLIST_IDS = Object.keys(CHECKLISTS) as ChecklistId[];

/** Медленная часть снапшота (ключевой кадр): как WorldView, но экипаж, цель, зоны и чек-листы — массивами. */
type KeyBlock = Omit<
    WorldView,
    'aircraft' | 'derived' | 'fighters' | 'wingmen' | 'bursts' | 'tracers' | 'bombs' | 'impacts' | 'mounts' | 'sight' | 'tick' | 'timeS' | 'station' | 'crew' | 'target' | 'damage' | 'checklists'
> & {
    /** Экипаж по порядку STATIONS: [здоровье, эффективность %, ИИ, прыгнул, задача]. */
    cr: number[][];
    /** Цель: статус, процент, повреждение секций ×100. */
    tg: [number, number, number[]];
    /** Повреждения: зоны ×100 по порядку ZONES; остальное — как в WorldView. */
    dm: Omit<WorldView['damage'], 'zones'> & { z: number[] };
    /** Чек-листы: битовая маска выполненных пунктов. */
    ck: Record<string, number>;
    ac: Pick<AircraftState, 'fuelKg' | 'hydraulicPressure' | 'trim' | 'batteryOn' | 'fuelPumpOn' | 'loadout' | 'engineFailed' | 'stallSide'> & { md: number[] };
    fighterTypes: string[];
};

const r2 = (v: number): number => Math.round(v * 100) / 100;

function packModifiers(m: AircraftModifiers): number[] {
    return [
        r2(m.elevator), r2(m.aileronLeft), r2(m.aileronRight), r2(m.rudder), r2(m.liftLoss[0]), r2(m.liftLoss[1]), Math.round(m.extraCd * 1e5),
        r2(m.enginePower[0]), r2(m.enginePower[1]), b(m.gearFailed), b(m.manualGearDown), b(m.hydraulicPumps[0]), b(m.hydraulicPumps[1]),
        b(m.bayDoorsJammed), b(m.flapsJammed), ...m.fuelLeakKgS.map((l) => Math.round(l * 1000)),
    ];
}

function unpackModifiers(md: number[]): AircraftModifiers {
    const n = (i: number): number => md[i] ?? 0;

    return {
        elevator: n(0), aileronLeft: n(1), aileronRight: n(2), rudder: n(3),
        liftLoss: [n(4), n(5)], extraCd: n(6) / 1e5, enginePower: [n(7), n(8)],
        gearFailed: n(9) === 1, manualGearDown: n(10) === 1, hydraulicPumps: [n(11) === 1, n(12) === 1],
        bayDoorsJammed: n(13) === 1, flapsJammed: n(14) === 1,
        fuelLeakKgS: md.slice(15).map((l) => l / 1000),
    };
}

export type EncodeState = { fighterTypes: string[]; lastBurstTick: number; lastImpactTick: number };

export function createEncodeState(): EncodeState {
    return { fighterTypes: [], lastBurstTick: -1, lastImpactTick: -1 };
}

function typeIndex(state: EncodeState, id: string): number {
    let i = state.fighterTypes.indexOf(id);

    if (i < 0) {
        state.fighterTypes.push(id);
        i = state.fighterTypes.length - 1;
    }

    return i;
}

/** Хост: снапшот мира для экипажа. */
export function encodeSnap(world: MissionWorld, key: boolean, ack: Record<string, number>, enc: EncodeState): SnapMsg {
    const view = buildView(world, 'pilot');
    const a = view.aircraft;
    const tick = view.tick;
    const sight = view.sight;
    const r = sight.readout;

    const fast: SnapMsg = {
        v: PROTOCOL_VERSION,
        t: tick,
        k: key ? 1 : 0,
        ack,
        a: [
            cm(a.position.x), cm(a.position.y), cm(a.position.z),
            cm(a.velocity.x), cm(a.velocity.y), cm(a.velocity.z),
            e4(a.attitude.w), e4(a.attitude.x), e4(a.attitude.y), e4(a.attitude.z),
            e4(a.omega.x), e4(a.omega.y), e4(a.omega.z),
            e4(a.controls.elevator), e4(a.controls.aileron), e4(a.controls.rudder),
            e3(a.gear), e3(a.flaps), e3(a.bayDoors),
            CONTACTS.indexOf(a.contact), a.touchdownVs === null ? -1 : Math.round(a.touchdownVs * 1000),
            e3(view.pilotThrottle[0]), e3(view.pilotThrottle[1]),
            cm(a.specificForce.x), cm(a.specificForce.y), cm(a.specificForce.z),
        ],
        e: a.engines.flatMap((en) => [MODES.indexOf(en.mode), Math.round(en.rpm), Math.round(en.manifoldInHg * 100), Math.round(en.chtC * 10), b(en.feathered), b(en.fire), e3(en.wear), Math.round(en.secondsInRed)]),
        f: view.fighters.map((f) => [f.id, typeIndex(enc, f.typeId), dm(f.position.x), dm(f.position.y), dm(f.position.z), dm(f.velocity.x), dm(f.velocity.y), dm(f.velocity.z), FIGHTER_PHASES.indexOf(f.phase), e3(f.hpShare), b(f.firing)]),
        w: view.wingmen.map((w) => [w.id, dm(w.position.x), dm(w.position.y), dm(w.position.z), dm(w.velocity.x), dm(w.velocity.y), dm(w.velocity.z)]),
        m: view.mounts.map((m) => [e4(m.az), e4(m.el), m.ammo, e3(m.heat), b(m.jammed), e3(Math.min(m.clearProgress, 1)), b(m.firing), b(m.disabled)]),
        tr: view.tracers.slice(0, MAX_TRACERS).map((t) => [dm(t.position.x), dm(t.position.y), dm(t.position.z), dm(t.velocity.x), dm(t.velocity.y), dm(t.velocity.z), b(t.enemy)]),
        bo: view.bombs.map((x) => [dm(x.position.x), dm(x.position.y), dm(x.position.z), dm(x.velocity.x), dm(x.velocity.y), dm(x.velocity.z)]),
        // Разрывы: в ключевом кадре — все видимые, между ними — только новые.
        bu: world.bursts
            .filter((x) => x.resolved && (key || x.tick > enc.lastBurstTick))
            .map((x) => [x.id, dm(x.position.x), dm(x.position.y), dm(x.position.z), FLAK.indexOf(x.typeId), x.tick]),
        im: world.recentImpacts()
            .filter((x) => key || x.tick > enc.lastImpactTick)
            .map((x) => [dm(x.position.x), dm(x.position.y), dm(x.position.z), x.tick, b(x.armed)]),
        q: world.events.length,
    };

    enc.lastBurstTick = Math.max(enc.lastBurstTick, ...world.bursts.filter((x) => x.resolved).map((x) => x.tick), -1);
    enc.lastImpactTick = Math.max(enc.lastImpactTick, ...world.impacts.map((x) => x.tick), -1);

    if (key || view.phase === 'bomb_run' || sight.on) {
        fast.s = [
            b(sight.on), b(sight.failed), dm(sight.altitudeSetM), cm(sight.tasSetMs), cm(sight.rateMs), e4(sight.driftRad),
            sight.aim === null ? 0 : dm(sight.aim.x), sight.aim === null ? 0 : dm(sight.aim.y), b(sight.aim !== null),
            sight.mode === 'salvo' ? 1 : 0, sight.intervalMs, b(sight.armed), b(sight.autoRelease), sight.rack, b(sight.doorsCommand),
            r ? e4(r.sightAngle) : 0, r ? e4(r.dropAngle) : 0, r ? e4(r.pdi) : 0,
            r && r.secondsToRelease !== null ? Math.round(r.secondsToRelease * 10) : -999999,
            r?.error ? dm(r.error.along) : 0, r?.error ? dm(r.error.across) : 0, b(r?.error !== null && r?.error !== undefined), b(r !== null),
        ];
    }

    if (key) {
        const block: KeyBlock = {
            phase: view.phase,
            flyingStation: view.flyingStation,
            difficulty: view.difficulty,
            pilotThrottle: view.pilotThrottle,
            copilot: view.copilot,
            orders: view.orders,
            cr: STATIONS.map((st) => {
                const c = view.crew.find((x) => x.station === st);

                return [HEALTH.indexOf(c?.health ?? 'ok'), Math.round((c?.efficiency ?? 1) * 100), b(c?.controller === 'ai'), b(c?.bailedOut ?? false), TASKS.indexOf((c?.task ?? null) as CrewTaskKind | null)];
            }),
            crewFlags: view.crewFlags,
            intercom: view.intercom,
            threats: view.threats,
            nav: {
                ...view.nav,
                dr: { x: Math.round(view.nav.dr.x), y: Math.round(view.nav.dr.y) },
                windEst: { x: Math.round(view.nav.windEst.x * 10) / 10, y: Math.round(view.nav.windEst.y * 10) / 10 },
                truePosition: view.nav.truePosition === null ? null : { x: Math.round(view.nav.truePosition.x), y: Math.round(view.nav.truePosition.y) },
                trueDrift: Math.round(view.nav.trueDrift * 1e4) / 1e4,
                groundSpeedMs: Math.round(view.nav.groundSpeedMs * 10) / 10,
            },
            radio: { ...view.radio, noise: Math.round(view.radio.noise * 100) / 100 },
            dm: (({ zones, ...rest }) => ({ ...rest, leakKgS: r2(rest.leakKgS), lastHitAgoS: rest.lastHitAgoS === null ? null : r2(rest.lastHitAgoS), z: ZONES.map((zid) => Math.round(zones[zid] * 100)) }))(view.damage),
            ck: Object.fromEntries(CHECKLIST_IDS.map((id) => [id, CHECKLISTS[id].reduce((mask, item, i) => mask | (view.checklists[id][item.id] ? 1 << i : 0), 0)])),
            tg: [['intact', 'damaged', 'destroyed'].indexOf(view.target.status), view.target.percent, view.target.sections.map((x) => Math.round(x.damage * 100))],
            canAccelerate: view.canAccelerate,
            outcome: view.outcome,
            training: null,
            ac: {
                fuelKg: a.fuelKg.map((f) => Math.round(f)),
                hydraulicPressure: Math.round(a.hydraulicPressure * 100) / 100,
                trim: { pitch: r2(a.trim.pitch), roll: r2(a.trim.roll), yaw: r2(a.trim.yaw) },
                md: packModifiers(a.modifiers),
                batteryOn: a.batteryOn,
                fuelPumpOn: a.fuelPumpOn,
                loadout: a.loadout,
                engineFailed: a.engineFailed,
                stallSide: a.stallSide,
            },
            fighterTypes: enc.fighterTypes,
        };

        fast.key = block as unknown as Record<string, unknown>;
    }

    return fast;
}

export type DecodeContext = {
    config: AircraftConfig;
    terrain: Terrain;
    weather: WeatherConfig;
    station: Station;
    /** Секции цели (центр, прочность) — из статики миссии; в снапшоте только их повреждение. */
    targetSections: { center: { x: number; y: number; z: number }; strength: number }[];
    targetHeading: number;
};

/** Состояние клиента между снапшотами: последний ключевой кадр, разрывы, разрывы бомб. */
export type DecodeState = {
    key: KeyBlock | null;
    bursts: Map<number, { position: { x: number; y: number; z: number }; tick: number; typeId: string }>;
    impacts: { position: { x: number; y: number; z: number }; tick: number; armed: boolean }[];
    lastTick: number;
};

export function createDecodeState(): DecodeState {
    return { key: null, bursts: new Map(), impacts: [], lastTick: -1 };
}

const v3 = (arr: number[], i: number, scale: number): { x: number; y: number; z: number } => ({ x: (arr[i] ?? 0) / scale, y: (arr[i + 1] ?? 0) / scale, z: (arr[i + 2] ?? 0) / scale });

/** Клиент: снапшот → WorldView для рендера и оверлеев. Без ключевого кадра — null. */
export function decodeSnap(msg: SnapMsg, dec: DecodeState, ctx: DecodeContext, prevView: WorldView | null): WorldView | null {
    if (msg.key !== undefined) {
        dec.key = msg.key as unknown as KeyBlock;
    }

    const key = dec.key;

    if (key === null || msg.t < dec.lastTick) {
        return null;
    }

    dec.lastTick = msg.t;

    const a = msg.a;
    const engines = [0, 1].map((i) => {
        const o = i * 8;
        const prevEngine = prevView?.aircraft.engines[i];

        return {
            mode: MODES[msg.e[o] ?? 0] ?? 'off',
            rpm: msg.e[o + 1] ?? 0,
            manifoldInHg: (msg.e[o + 2] ?? 0) / 100,
            powerW: prevEngine?.powerW ?? 0,
            thrustN: prevEngine?.thrustN ?? 0,
            propDragN: 0,
            chtC: (msg.e[o + 3] ?? 0) / 10,
            wear: (msg.e[o + 6] ?? 0) / 1000,
            fuelFlowKgS: 0,
            feathered: msg.e[o + 4] === 1,
            primed: 0,
            crankingS: 0,
            fire: msg.e[o + 5] === 1,
            secondsInRed: msg.e[o + 7] ?? 0,
        };
    }) as AircraftState['engines'];

    const aircraft: AircraftState = {
        position: v3(a, 0, 100),
        velocity: v3(a, 3, 100),
        attitude: { w: (a[6] ?? 1e4) / 1e4, x: (a[7] ?? 0) / 1e4, y: (a[8] ?? 0) / 1e4, z: (a[9] ?? 0) / 1e4 },
        omega: v3(a, 10, 1e4),
        trim: key.ac.trim,
        controls: { elevator: (a[13] ?? 0) / 1e4, aileron: (a[14] ?? 0) / 1e4, rudder: (a[15] ?? 0) / 1e4 },
        gear: (a[16] ?? 0) / 1e3,
        flaps: (a[17] ?? 0) / 1e3,
        bayDoors: (a[18] ?? 0) / 1e3,
        fuelKg: key.ac.fuelKg,
        loadout: key.ac.loadout,
        engines,
        engineFailed: key.ac.engineFailed,
        contact: CONTACTS[a[19] ?? 0] ?? 'air',
        touchdownVs: (a[20] ?? -1) < 0 ? null : (a[20] ?? 0) / 1000,
        stallSide: key.ac.stallSide,
        hydraulicPressure: key.ac.hydraulicPressure,
        batteryOn: key.ac.batteryOn,
        fuelPumpOn: key.ac.fuelPumpOn,
        specificForce: v3(a, 23, 100),
        modifiers: unpackModifiers(key.ac.md),
    };

    // Разрывы и разрывы бомб копятся на клиенте и стареют по тикам.
    for (const x of msg.bu) {
        dec.bursts.set(x[0] ?? 0, { position: v3(x, 1, 10), typeId: FLAK[x[4] ?? 0] ?? 'heavy', tick: x[5] ?? 0 });
    }

    for (const [id, x] of dec.bursts) {
        if (msg.t - x.tick > 8 * 60) {
            dec.bursts.delete(id);
        }
    }

    for (const x of msg.im) {
        const tick = x[3] ?? 0;

        if (!dec.impacts.some((i) => i.tick === tick && Math.abs(i.position.x - (x[0] ?? 0) / 10) < 0.5)) {
            dec.impacts.push({ position: v3(x, 0, 10), tick, armed: x[4] === 1 });
        }
    }

    dec.impacts = dec.impacts.filter((i) => msg.t - i.tick < 25 * 60);

    const s = msg.s;
    const prevSight = prevView?.sight;
    const sight: WorldView['sight'] =
        s === undefined && prevSight !== undefined
            ? prevSight
            : s === undefined
              ? { on: false, failed: false, altitudeSetM: 3000, tasSetMs: 95, rateMs: 95, driftRad: 0, aim: null, mode: 'train', intervalMs: 120, armed: false, autoRelease: true, readout: null, rack: 0, doorsCommand: false }
              : {
                    on: s[0] === 1,
                    failed: s[1] === 1,
                    altitudeSetM: (s[2] ?? 0) / 10,
                    tasSetMs: (s[3] ?? 0) / 100,
                    rateMs: (s[4] ?? 0) / 100,
                    driftRad: (s[5] ?? 0) / 1e4,
                    aim: s[8] === 1 ? { x: (s[6] ?? 0) / 10, y: (s[7] ?? 0) / 10 } : null,
                    mode: s[9] === 1 ? 'salvo' : 'train',
                    intervalMs: s[10] ?? 120,
                    armed: s[11] === 1,
                    autoRelease: s[12] === 1,
                    rack: s[13] ?? 0,
                    doorsCommand: s[14] === 1,
                    readout:
                        s[22] === 1
                            ? {
                                  sightAngle: (s[15] ?? 0) / 1e4,
                                  dropAngle: (s[16] ?? 0) / 1e4,
                                  pdi: (s[17] ?? 0) / 1e4,
                                  secondsToRelease: (s[18] ?? -999999) <= -999999 ? null : (s[18] ?? 0) / 10,
                                  error: s[21] === 1 ? { along: (s[19] ?? 0) / 10, across: (s[20] ?? 0) / 10 } : null,
                              }
                            : null,
                };

    return {
        tick: msg.t,
        timeS: msg.t / 60,
        phase: key.phase,
        station: ctx.station,
        flyingStation: key.flyingStation,
        difficulty: key.difficulty,
        aircraft,
        derived: derive(ctx.config, aircraft, ctx.terrain, ctx.weather),
        pilotThrottle: [(a[21] ?? 0) / 1e3, (a[22] ?? 0) / 1e3],
        copilot: key.copilot,
        orders: key.orders,
        crew: STATIONS.map((st, i) => {
            const c = key.cr[i] ?? [0, 100, 1, 0, 0];

            return { station: st, health: HEALTH[c[0] ?? 0] ?? 'ok', efficiency: (c[1] ?? 100) / 100, controller: c[2] === 1 ? 'ai' : 'human', bailedOut: c[3] === 1, task: TASKS[c[4] ?? 0] ?? null };
        }),
        crewFlags: key.crewFlags,
        intercom: key.intercom,
        threats: key.threats,
        fighters: msg.f.map((x) => ({
            id: x[0] ?? 0,
            typeId: key.fighterTypes[x[1] ?? 0] ?? 'bf109g',
            position: v3(x, 2, 10),
            velocity: v3(x, 5, 10),
            phase: FIGHTER_PHASES[x[8] ?? 0] ?? 'patrol',
            hpShare: (x[9] ?? 0) / 1e3,
            firing: x[10] === 1,
        })),
        wingmen: msg.w.map((x) => ({ id: x[0] ?? 0, position: v3(x, 1, 10), velocity: v3(x, 4, 10) })),
        bursts: [...dec.bursts.entries()].map(([id, x]) => ({ id, position: x.position, ageS: (msg.t - x.tick) / 60, typeId: x.typeId })),
        tracers: msg.tr.map((x) => ({ position: v3(x, 0, 10), velocity: v3(x, 3, 10), enemy: x[6] === 1 })),
        bombs: msg.bo.map((x) => ({ position: v3(x, 0, 10), velocity: v3(x, 3, 10) })),
        impacts: dec.impacts.map((i) => ({ position: i.position, ageS: (msg.t - i.tick) / 60, armed: i.armed })),
        mounts: msg.m.map((x, i) => {
            // Порядок установок — как в конфиге самолёта (createMounts).
            const gun = ctx.config.guns[i];

            return {
                id: gun?.id ?? '',
                station: gun?.station ?? 'pilot',
                fixed: gun?.mount === 'fixed',
                az: (x[0] ?? 0) / 1e4,
                el: (x[1] ?? 0) / 1e4,
                ammo: x[2] ?? 0,
                heat: (x[3] ?? 0) / 1e3,
                jammed: x[4] === 1,
                clearProgress: (x[5] ?? 0) / 1e3,
                firing: x[6] === 1,
                disabled: x[7] === 1,
            };
        }),
        sight,
        nav: key.nav,
        radio: key.radio,
        damage: (({ z, ...rest }) => ({ ...rest, zones: Object.fromEntries(ZONES.map((zid, i) => [zid, (z[i] ?? 100) / 100])) as Record<ZoneId, number> }))(key.dm),
        checklists: Object.fromEntries(CHECKLIST_IDS.map((id) => [id, Object.fromEntries(CHECKLISTS[id].map((item, i) => [item.id, ((key.ck[id] ?? 0) & (1 << i)) !== 0]))])) as WorldView['checklists'],
        target: {
            status: (['intact', 'damaged', 'destroyed'] as const)[key.tg[0]] ?? 'intact',
            percent: key.tg[1],
            heading: ctx.targetHeading,
            sections: ctx.targetSections.map((x, i) => ({ center: x.center, strength: x.strength, damage: (key.tg[2][i] ?? 0) / 100 })),
        },
        canAccelerate: key.canAccelerate,
        outcome: key.outcome,
        training: null,
    };
}
