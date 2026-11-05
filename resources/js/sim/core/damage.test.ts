import { describe, expect, it } from 'vitest';
import { aerodynamics } from './aircraft';
import type { Station, SubsystemId, ZoneId } from './config';
import { applyHit, extinguishEngine, failed, hitSubsystem, raycastZones, stepDamage, zoneWeights } from './damage';
import { vec } from './math';
import type { MissionDefinition } from './mission/schema';
import { b25j, milkRun, milkRunWorld } from './testing';
import type { MissionWorld } from './world';

/**
 * Каждая строка таблицы повреждений раздела 7.3 покрыта тестом эффекта (критерий этапа 2).
 */
const quiet: MissionDefinition = { ...milkRun, threats: { flak: [], fighter_waves: [] }, triggers: [], formation: { wingmen: 0, spacing_m: 70 } };

function airborne(humans: Station[] = ['copilot', 'bombardier', 'navigator', 'top_gunner', 'radio', 'waist_gunner', 'tail_gunner']): MissionWorld {
    const world = milkRunWorld({
        mission: quiet,
        seed: 21,
        humans,
        start: { phase: 'route', position: vec(50000, 30000, 3000), heading: 1.5, speedMs: 98, enginesRunning: true, gearDown: false, legIndex: 3 },
    });

    world.pilot.throttle = [0.8, 0.8];

    return world;
}

const destroy = (world: MissionWorld, sub: SubsystemId): void => hitSubsystem(world.damageContext(), world.damage, sub, 1000);

const pound = (world: MissionWorld, zone: ZoneId, hits: number, amount = 1): void => {
    for (let i = 0; i < hits; i++) {
        applyHit(world.damageContext(), world.damage, zone, amount, 'test');
    }
};

const refresh = (world: MissionWorld): void => stepDamage(world.damageContext(), world.damage, 1 / 60);

describe('damage geometry', () => {
    it('a ray from behind hits the tail first', () => {
        expect(raycastZones(b25j, vec(-40, 0, -1), vec(1, 0, 0), 60)).toBe('tail');
    });

    it('a ray from the left wingtip side hits the outer left wing', () => {
        expect(raycastZones(b25j, vec(0, -30, 0), vec(0, 1, 0), 40)).toBe('wing_left_outer');
    });

    it('fragments from below weight the wings and gear more than the nose', () => {
        const w = zoneWeights(b25j, vec(0, 0, 1));
        const weight = (z: ZoneId): number => w.find((x) => x.zone === z)?.weight ?? 0;

        expect(weight('wing_left_outer')).toBeGreaterThan(weight('nose'));
        expect(weight('gear')).toBeGreaterThan(0);
    });
});

describe('damage table (section 7.3)', () => {
    it('nose: sight failure means manual release; bombardier can be wounded', () => {
        const world = airborne();

        destroy(world, 'bombsight');
        expect(failed(world.damage, 'bombsight')).toBe(true);

        world.act('bombardier', { type: 'sight_on' });
        expect(world.sight.on).toBe(false);

        // Ручной сброс по-прежнему доступен.
        world.act('bombardier', { type: 'doors', open: true });
        world.run(60 * 4);
        world.act('bombardier', { type: 'release' });
        world.run(5);
        expect(world.bombs.length + world.impacts.length).toBeGreaterThan(0);

        pound(world, 'nose', 200, 4);
        expect(world.member('bombardier').health).not.toBe('ok');
    });

    it('cockpit: instruments fail, a pilot wound hands control to the copilot', () => {
        const world = airborne(['bombardier', 'navigator', 'top_gunner', 'radio', 'waist_gunner', 'tail_gunner']);

        destroy(world, 'instruments');
        expect(failed(world.damage, 'instruments')).toBe(true);

        world.crew.members.pilot.health = 'incapacitated';
        world.crew.members.pilot.efficiency = 0;
        world.run(60);
        expect(world.crew.flyingStation).toBe('copilot');
        expect(world.events.some((e) => e.type === 'control_handover')).toBe(true);
    });

    it('engine: hits cost power, oil loss seizes the engine, fire is possible', () => {
        const world = airborne();

        world.run(120);
        const before = world.aircraft.engines[0].powerW;

        pound(world, 'engine_left', 5);
        refresh(world);
        world.run(60);
        expect(world.aircraft.modifiers.enginePower[0]).toBeLessThan(1);
        expect(world.aircraft.engines[0].powerW).toBeLessThan(before);

        destroy(world, 'oil_left');
        expect(world.damage.oilSeizeS[0]).not.toBeNull();
        world.run(60 * (b25j.damage_model.value.oil_leak_seize_s + 2));
        expect(world.aircraft.engineFailed[0]).toBe(true);
        expect(world.events.some((e) => e.type === 'engine_seized')).toBe(true);

        // Пожар двигателя: огнетушитель одноразовый.
        const ctx = world.damageContext();

        world.damage.engineFireS[1] = 0;
        world.aircraft.engines[1] = { ...world.aircraft.engines[1], fire: true, feathered: true };
        extinguishEngine(ctx, world.damage, 1);
        expect(world.damage.extinguishers[1]).toBe(false);
        expect(extinguishEngine(ctx, world.damage, 1)).toBe(false);
    });

    it('wing: tank leaks, lift asymmetry rolls the aircraft, aileron can be lost', () => {
        const world = airborne();
        const fuel = (): number => world.aircraft.fuelKg[0] ?? 0;

        destroy(world, 'tank_left_main');
        refresh(world);
        expect(world.aircraft.modifiers.fuelLeakKgS[0]).toBeGreaterThan(0.3);

        const start = fuel();

        world.run(600);
        expect(fuel()).toBeLessThan(start - 3);

        pound(world, 'wing_left_inner', 30);
        refresh(world);
        expect(world.aircraft.modifiers.liftLoss[0]).toBeGreaterThan(world.aircraft.modifiers.liftLoss[1]);

        const s = world.aircraft;
        const aero = aerodynamics(b25j, { ...s, omega: vec(), controls: { elevator: 0, aileron: 0, rudder: 0 } }, vec(98, 0, 98 * 0.05), 0.9, 3000);

        // Левое крыло без части подъёмной силы — крен влево (отрицательный момент по x).
        expect(aero.moment.x).toBeLessThan(0);

        destroy(world, 'aileron_left');
        refresh(world);
        expect(world.aircraft.modifiers.aileronLeft).toBe(0);
    });

    it('mid fuselage: bay doors jam, turret and radio fail, wiring can start a fire', () => {
        const world = airborne();

        destroy(world, 'bomb_bay');
        refresh(world);
        expect(world.aircraft.modifiers.bayDoorsJammed).toBe(true);
        world.act('bombardier', { type: 'doors', open: true });
        world.run(60 * 5);
        expect(world.aircraft.bayDoors).toBe(0);

        destroy(world, 'turret');
        world.run(2);
        expect(world.mounts.find((m) => m.id === 'top_turret')?.disabled).toBe(true);

        destroy(world, 'radio');
        world.run(2);
        expect(world.radio.failed).toBe(true);

        // Пожар внутри: бортинженер тушит (верхняя турель на это время пуста).
        world.damage.fuselageFire = true;
        world.act('top_gunner', { type: 'task', kind: 'extinguish' });
        expect(world.member('top_gunner').task?.kind).toBe('extinguish');
        world.run(60 * (b25j.damage_model.value.extinguish_s + 1));
        expect(world.damage.fuselageFire).toBe(false);
    });

    it('rear fuselage: gunners get wounded, a cut cable loses a control surface', () => {
        const world = airborne();

        pound(world, 'fuselage_rear', 60, 4);
        expect(['wounded', 'incapacitated']).toContain(world.member('waist_gunner').health === 'ok' ? world.member('radio').health : world.member('waist_gunner').health);

        const w2 = airborne();

        destroy(w2, 'control_cables');
        refresh(w2);
        const m = w2.aircraft.modifiers;

        expect(m.rudder === 0 || m.elevator < 0.5).toBe(true);
    });

    it('tail: control effectiveness drops, tail gunner can be wounded', () => {
        const world = airborne();

        pound(world, 'tail', 8);
        refresh(world);
        expect(world.aircraft.modifiers.elevator).toBeLessThan(1);
        expect(world.aircraft.modifiers.rudder).toBeLessThan(1);

        pound(world, 'tail', 200, 4);
        expect(world.member('tail_gunner').health).not.toBe('ok');
    });

    it('gear: struts destroyed → gear will not extend → belly landing', () => {
        const world = airborne();

        destroy(world, 'gear_struts');
        refresh(world);
        expect(world.aircraft.modifiers.gearFailed).toBe(true);

        world.act('copilot', { type: 'gear', down: true });
        world.run(60 * 10);
        expect(world.aircraft.gear).toBeLessThan(0.1);
    });

    it('lost hydraulics: the engineer cranks the gear down by hand', () => {
        const world = airborne();

        destroy(world, 'hydraulic_pump_left');
        destroy(world, 'hydraulic_pump_right');
        world.run(60 * 70);
        expect(world.aircraft.hydraulicPressure).toBeLessThan(0.3);

        world.act('copilot', { type: 'gear', down: true });
        world.run(60 * 3);
        expect(world.aircraft.gear).toBeLessThan(0.1);

        world.act('top_gunner', { type: 'task', kind: 'emergency_gear' });
        world.run(60 * (b25j.damage_model.value.emergency_gear_s + 6));
        expect(world.aircraft.gear).toBeGreaterThan(0.98);
    });

    it('an unextinguished wing fire destroys the wing after the configured time', () => {
        const world = airborne();

        world.damage.wingFireS[1] = 0;
        world.run(60 * (b25j.damage_model.value.wing_fire_destruction_s + 1));
        expect(world.damage.wingDestroyed[1]).toBe(true);
        expect(world.aircraft.modifiers.liftLoss[1]).toBe(1);
    });

    it('self-sealing tanks close small holes but not big ones', () => {
        const world = airborne();

        world.damage.smallLeaks[2] = 0.12;
        world.damage.bigLeaks[3] = 0.6;
        world.run(60 * 120);
        expect(world.damage.smallLeaks[2]).toBeLessThan(0.01);
        expect(world.damage.bigLeaks[3]).toBe(0.6);
    });
});
