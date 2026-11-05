import type {
    AircraftDerived,
    AircraftState,
    ChecklistId,
    ChecklistState,
    CopilotControls,
    Health,
    IntercomMessage,
    MissionWorld,
    Outcome,
    Phase,
    RadioMeaning,
    SightReadout,
    Station,
    SubsystemId,
    ThreatMarker,
    TrainingResult,
    Vec3,
    ZoneId,
} from './core';
import { activeTransmissions, failed, noiseLevel, SUBSYSTEMS, TICK_HZ, ZONES } from './core';

/**
 * Снимок мира для потока рендера и оверлеев Vue (воркер → главный поток каждый кадр).
 * Только данные, без методов: structured clone. Содержит то, что видит станция игрока;
 * точное место для штурмана — только в «Учебном» режиме (раздел 6.3).
 */
export type WorldView = {
    tick: number;
    timeS: number;
    phase: Phase;
    station: Station;
    flyingStation: 'pilot' | 'copilot';
    difficulty: 'training' | 'historical';
    aircraft: AircraftState;
    derived: AircraftDerived;
    pilotThrottle: [number, number];
    copilot: CopilotControls;
    orders: { gearDown: boolean | null; flaps: number | null };
    crew: { station: Station; health: Health; efficiency: number; controller: 'ai' | 'human'; bailedOut: boolean; task: string | null }[];
    crewFlags: { prepareBailOut: boolean; bailOutOrdered: boolean; oxygenOn: boolean; takeControlRequested: boolean };
    intercom: IntercomMessage[];
    threats: ThreatMarker[];
    fighters: { id: number; typeId: string; position: Vec3; velocity: Vec3; phase: string; hpShare: number; firing: boolean }[];
    wingmen: { id: number; position: Vec3; velocity: Vec3 }[];
    bursts: { id: number; position: Vec3; ageS: number; typeId: string }[];
    tracers: { position: Vec3; velocity: Vec3; enemy: boolean }[];
    bombs: { position: Vec3; velocity: Vec3 }[];
    impacts: { position: Vec3; ageS: number; armed: boolean }[];
    mounts: { id: string; station: Station; az: number; el: number; ammo: number; heat: number; jammed: boolean; clearProgress: number; firing: boolean; disabled: boolean; fixed: boolean }[];
    sight: {
        on: boolean;
        failed: boolean;
        altitudeSetM: number;
        tasSetMs: number;
        rateMs: number;
        driftRad: number;
        aim: { x: number; y: number } | null;
        mode: 'salvo' | 'train';
        intervalMs: number;
        armed: boolean;
        autoRelease: boolean;
        readout: SightReadout | null;
        rack: number;
        doorsCommand: boolean;
    };
    nav: {
        dr: { x: number; y: number };
        windEst: { x: number; y: number };
        legIndex: number;
        courseToSteer: number | null;
        etaS: number | null;
        requiredIasMs: number | null;
        fixes: number;
        truePosition: { x: number; y: number } | null;
        visibleLandmarks: string[];
        trueDrift: number;
        groundSpeedMs: number;
    };
    radio: {
        dialMhz: number;
        noise: number;
        iff: boolean;
        failed: boolean;
        activeTransmissions: number;
        received: { messageId: string; group: string; decoded: RadioMeaning | null; correct: boolean | null }[];
        distressSent: boolean;
    };
    damage: {
        zones: Record<ZoneId, number>;
        engineFire: [boolean, boolean];
        wingFire: [boolean, boolean];
        fuselageFire: boolean;
        failed: SubsystemId[];
        leakKgS: number;
        extinguishers: [boolean, boolean];
        structuralFailure: boolean;
        lastHitAgoS: number | null;
    };
    checklists: ChecklistState;
    target: { sections: { center: Vec3; damage: number; strength: number }[]; status: 'destroyed' | 'damaged' | 'intact'; percent: number; heading: number };
    canAccelerate: boolean;
    outcome: Outcome | null;
    training: TrainingResult | null;
};

const MAX_TRACERS = 160;

export function buildView(world: MissionWorld, station: Station, training: TrainingResult | null = null): WorldView {
    const a = world.aircraft;
    const d = world.derived();
    const tick = world.tick;
    const ageS = (t: number): number => (tick - t) / TICK_HZ;
    const target = world.knownTarget();
    const result = world.targetResult();
    const zones = {} as Record<ZoneId, number>;

    for (const z of ZONES) {
        zones[z] = world.zoneShare(z);
    }

    const tracers: WorldView['tracers'] = [];

    for (const b of world.bullets) {
        if (b.tracer && tracers.length < MAX_TRACERS) {
            tracers.push({ position: b.position, velocity: b.velocity, enemy: b.owner !== 'bomber' });
        }
    }

    const range = world.visualRange();

    return {
        tick,
        timeS: world.timeS,
        phase: world.phase,
        station,
        flyingStation: world.crew.flyingStation,
        difficulty: world.difficulty,
        aircraft: a,
        derived: d,
        pilotThrottle: [...world.pilot.throttle],
        copilot: world.copilot,
        orders: { gearDown: world.orders.gearDown, flaps: world.orders.flaps },
        crew: Object.values(world.crew.members).map((m) => ({
            station: m.station,
            health: m.health,
            efficiency: m.efficiency,
            controller: m.controller,
            bailedOut: m.bailedOut,
            task: m.task?.kind ?? null,
        })),
        crewFlags: {
            prepareBailOut: world.crew.prepareBailOut,
            bailOutOrdered: world.crew.bailOutOrdered,
            oxygenOn: world.crew.oxygenOn,
            takeControlRequested: world.crew.takeControlRequestedTick !== null,
        },
        intercom: world.crew.intercom.slice(-5),
        threats: world.crew.threats,
        fighters: world.fighters.map((f) => ({
            id: f.id,
            typeId: f.typeId,
            position: f.position,
            velocity: f.velocity,
            phase: f.phase,
            hpShare: Math.max(0, f.hp) / (world.content.fighters.fighters.find((t) => t.id === f.typeId)?.hp ?? 1),
            firing: f.firing,
        })),
        wingmen: world.wingmen.map((w) => ({ id: w.id, position: w.position, velocity: w.velocity })),
        bursts: world.bursts.filter((b) => b.resolved).map((b) => ({ id: b.id, position: b.position, ageS: ageS(b.tick), typeId: b.typeId })),
        tracers,
        bombs: world.bombs.map((b) => ({ position: b.position, velocity: b.velocity })),
        impacts: world.recentImpacts().map((i) => ({ position: i.position, ageS: ageS(i.tick), armed: i.armed })),
        mounts: world.mounts.map((m) => ({
            id: m.id,
            station: m.station,
            az: m.az,
            el: m.el,
            ammo: m.ammo,
            heat: m.heat,
            jammed: m.jammed,
            clearProgress: m.clearHoldS / world.content.gun.gameplay.value.clear_jam_hold_s,
            firing: m.firing,
            disabled: m.disabled,
            fixed: m.fixed,
        })),
        sight: {
            on: world.sight.on,
            failed: world.sight.failed,
            altitudeSetM: world.sight.altitudeSetM,
            tasSetMs: world.sight.tasSetMs,
            rateMs: world.sight.rateMs,
            driftRad: world.sight.driftRad,
            aim: world.sight.aim,
            mode: world.sight.mode,
            intervalMs: world.sight.intervalMs,
            armed: world.sight.armed,
            autoRelease: world.sight.autoRelease,
            readout: world.sightReadout(),
            rack: world.rack.length,
            doorsCommand: world.doorsCommand,
        },
        nav: {
            dr: world.nav.dr,
            windEst: world.nav.windEst,
            legIndex: world.nav.legIndex,
            courseToSteer: world.nav.courseToSteer,
            etaS: world.nav.etaS,
            requiredIasMs: world.nav.requiredIasMs,
            fixes: world.nav.fixes,
            truePosition: world.difficulty === 'training' ? { x: a.position.x, y: a.position.y } : null,
            visibleLandmarks: world.landmarks.filter((l) => Math.hypot(l.position.x - a.position.x, l.position.y - a.position.y) < range).map((l) => l.id),
            trueDrift: Math.atan2(a.velocity.x, a.velocity.y) - d.heading,
            groundSpeedMs: Math.hypot(a.velocity.x, a.velocity.y),
        },
        radio: {
            dialMhz: world.radio.dialMhz,
            noise: noiseLevel(world.radio, tick),
            iff: world.radio.iff,
            failed: world.radio.failed,
            activeTransmissions: activeTransmissions(world.radio, tick).length,
            received: world.radio.received.map((r) => ({ messageId: r.messageId, group: r.group, decoded: r.decoded, correct: r.correct })),
            distressSent: world.radio.distressSent,
        },
        damage: {
            zones,
            engineFire: [world.damage.engineFireS[0] !== null, world.damage.engineFireS[1] !== null],
            wingFire: [world.damage.wingFireS[0] !== null, world.damage.wingFireS[1] !== null],
            fuselageFire: world.damage.fuselageFire,
            failed: SUBSYSTEMS.filter((s) => failed(world.damage, s)),
            leakKgS: a.modifiers.fuelLeakKgS.reduce((s, l) => s + l, 0),
            extinguishers: [...world.damage.extinguishers],
            structuralFailure: world.damage.structuralFailure,
            lastHitAgoS: world.damage.lastHitTick === null ? null : ageS(world.damage.lastHitTick),
        },
        checklists: world.checklists,
        target: {
            sections: target.sections.map((s) => ({ center: s.center, damage: s.damage, strength: s.strength })),
            status: result.status,
            percent: result.percent,
            heading: target.heading,
        },
        canAccelerate: world.canAccelerate(),
        outcome: world.outcome,
        training,
    };
}

/** Статика миссии для карты, брифинга и рендера — один раз при старте. */
export type MissionStatic = {
    waypoints: { id: string; type: string; position: Vec3 }[];
    landmarks: { id: string; position: Vec3; kind: string }[];
    beacon: Vec3;
    runway: { x: number; y: number; heading: number; length_m: number; width_m: number; elevation_m: number };
    target: { aim: Vec3; heading: number; sections: { center: Vec3; halfLength: number; halfWidth: number }[] };
    checklists: Record<ChecklistId, string[]>;
    codeTable: { group: string; meaning: RadioMeaning }[];
    frequencies: { tower: number; command: number; base: number };
    timeOverTargetS: number;
};

export function buildStatic(world: MissionWorld): MissionStatic {
    const t = world.knownTarget();

    return {
        waypoints: world.waypoints.map((w) => ({ id: w.id, type: w.type, position: w.position })),
        landmarks: world.landmarks,
        beacon: world.beacon,
        runway: world.runway,
        target: { aim: t.aim, heading: t.heading, sections: t.sections.map((s) => ({ center: s.center, halfLength: s.halfLength, halfWidth: s.halfWidth })) },
        checklists: world.checklistDefs(),
        codeTable: world.mission.radio.code_table,
        frequencies: world.mission.radio.frequencies_mhz,
        timeOverTargetS: world.mission.time_over_target.at_s,
    };
}
