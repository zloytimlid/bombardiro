import type { AircraftInput } from '../../aircraft';
import { isActive } from '../../crew';
import { clamp, wrapPi } from '../../math';
import { bearing, distance2 } from '../../mission/geo';
import type { FlightControls, MissionWorld } from '../../world';
import type { AutopilotTargets } from '../autopilot';
import { Autopilot } from '../autopilot';
import { CircuitPilot, defaultCircuit } from '../circuit';

/**
 * Пилотирование ИИ по фазам вылета (раздел 6.1): взлёт, маршрут по курсам штурмана,
 * противозенитный манёвр до IP, боевой курс по PDI, отход, заход и посадка.
 * Работает теми же органами, что игрок; шасси и закрылки — приказами второму пилоту.
 * Используется пилотом и вторым пилотом после передачи управления.
 */
const CRUISE_IAS = 86;
const CLIMB_IAS = 72;
const WEAVE_HEADING = 0.22;

export class FlightLogic {
    private readonly ap = new Autopilot();
    private takeoff: CircuitPilot | null = null;
    private landing: CircuitPilot | null = null;
    private weaveSign = 1;
    private weaveTimerS = 0;
    private readyTimerS = 0;
    private reportedReady = false;
    private lastGear: boolean | null = null;
    private lastFlaps: number | null = null;
    private abortChecked = false;

    constructor(private readonly station: 'pilot' | 'copilot') {}

    private controls(world: MissionWorld): FlightControls {
        return this.station === 'pilot' ? world.pilot : world.copilotFlight;
    }

    private apply(world: MissionWorld, input: AircraftInput): void {
        const c = this.controls(world);

        c.pitch = input.pitch;
        c.roll = input.roll;
        c.yaw = input.yaw;
        c.brakeLeft = input.brakeLeft;
        c.brakeRight = input.brakeRight;
        c.throttle = [input.engines[0].throttle, input.engines[1].throttle];

        // На одном двигателе: работающий отдаёт двойную долю, педаль держит курс.
        const t = input.engines[0].throttle;

        if (world.aircraft.engines[0].mode !== 'running' || world.aircraft.engines[0].feathered) {
            c.throttle = [0, Math.min(1, 2 * t)];
        } else if (world.aircraft.engines[1].mode !== 'running' || world.aircraft.engines[1].feathered) {
            c.throttle = [Math.min(1, 2 * t), 0];
        }

        if (input.gearDown !== this.lastGear) {
            this.lastGear = input.gearDown;
            world.act(this.station, { type: 'gear', down: input.gearDown });
        }

        if (input.flaps !== this.lastFlaps) {
            this.lastFlaps = input.flaps;
            world.act(this.station, { type: 'flaps', value: input.flaps });
        }
    }

    private fly(world: MissionWorld, t: AutopilotTargets, dt: number): void {
        const input = this.ap.update(world.aircraft, world.derived(), { alphaMax: 0.15, ...t }, dt);

        this.apply(world, input);
    }

    /** Решения командира: возврат, покидание, приводнение (раздел 6.1). */
    private decide(world: MissionWorld): void {
        const a = world.aircraft;
        const d = world.derived();
        const engines = a.engines.filter((e) => e.mode === 'running' && !e.feathered).length;
        const wingFire = world.damage.wingFireS.some((s) => s !== null && s > 20);

        if (!world.crew.bailOutOrdered && a.contact === 'air' && (world.aircraftLost || wingFire || (engines === 0 && d.agl > 500 && !world.terrain.isWater(a.position.x, a.position.y)))) {
            world.act('pilot', { type: 'order', order: 'bailout' });
            world.act(this.station, { type: 'order', order: 'bailout' });
            world.act('radio', { type: 'distress' });
        }

        // Отказ двигателя до цели — возврат на базу.
        if (!this.abortChecked && engines < 2 && (world.phase === 'formup' || world.phase === 'route')) {
            this.abortChecked = true;
            world.event('abort', { reason: 'engine' });
            world.say(this.station, 'intercom.returning');
            world.setPhase('return');
        }
    }

    update(world: MissionWorld, dt: number): void {
        const a = world.aircraft;
        const d = world.derived();

        if (world.crew.bailOutOrdered) {
            // Держим крылья ровно, пока экипаж прыгает.
            this.fly(world, { bank: 0, pitch: 0.02, throttle: 0.5 }, dt);

            return;
        }

        this.decide(world);

        switch (world.phase) {
            case 'preflight': {
                const running = a.engines.every((e) => e.mode === 'running');

                if (!running) {
                    this.fly(world, { throttle: 0, brakes: 1, gearDown: true, flaps: 0 }, dt);
                    this.readyTimerS = 0;

                    return;
                }

                this.readyTimerS += dt;

                if (!this.reportedReady) {
                    this.reportedReady = true;
                    world.act(this.station, { type: 'order', order: 'report_ready' });
                }

                if (this.readyTimerS < 8) {
                    this.fly(world, { throttle: 0, brakes: 1, gearDown: true, flaps: 0.25 }, dt);

                    return;
                }

                this.takeoff ??= new CircuitPilot(defaultCircuit(world.runway));
                this.apply(world, this.takeoff.update(a, d, dt));

                return;
            }
            case 'takeoff':
                this.takeoff ??= new CircuitPilot(defaultCircuit(world.runway), a.contact === 'air' ? 'climb' : 'takeoff_roll');
                this.apply(world, this.takeoff.update(a, d, dt));

                return;
            case 'landing':
                this.updateLanding(world, dt);

                return;
            case 'debrief':
                this.fly(world, { throttle: 0, brakes: 1 }, dt);

                return;
            case 'bomb_run':
                this.updateBombRun(world, dt);

                return;
            default:
                this.updateRoute(world, dt);
        }
    }

    private updateRoute(world: MissionWorld, dt: number): void {
        const d = world.derived();
        const nav = world.nav;
        const next = world.waypointPosition(nav.legIndex);
        const heading = nav.courseToSteer ?? (next !== null ? bearing(world.aircraft.position, next) : d.heading);
        const altitude = next?.z ?? d.altitude;
        const climbing = altitude - d.altitude > 120;
        let ias = world.phase === 'route' && nav.requiredIasMs !== null ? nav.requiredIasMs : CRUISE_IAS;
        let headingCmd = heading;

        // Противозенитный манёвр до IP: «змейка» по курсу, пока по нам работают зенитки.
        const flakNear = world.bursts.some((b) => world.tick - b.tick < 20 * 60 && distance2(b.position, world.aircraft.position) < 3000);

        if ((world.phase === 'route' || world.phase === 'egress' || world.phase === 'return') && flakNear) {
            this.weaveTimerS -= dt;

            if (this.weaveTimerS <= 0) {
                this.weaveSign = -this.weaveSign;
                this.weaveTimerS = 12 + world.rng.range(0, 6);
            }

            headingCmd = wrapPi(heading + this.weaveSign * WEAVE_HEADING);
        }

        if (climbing) {
            ias = CLIMB_IAS;
            this.fly(world, { heading: headingCmd, airspeedByPitch: ias, throttle: 1, gearDown: false, flaps: 0 }, dt);

            return;
        }

        this.fly(world, { heading: headingCmd, altitude, maxVerticalSpeed: 6, airspeed: ias, gearDown: false, flaps: 0 }, dt);
    }

    private updateBombRun(world: MissionWorld, dt: number): void {
        const d = world.derived();
        const ref = world.metrics.bombRun;
        const readout = world.sightReadout();
        const target = world.knownTarget();
        let heading: number;

        if (readout !== null && world.sight.on) {
            // Строго по PDI: стрелка вправо — доворот вправо, малыми кренами.
            heading = wrapPi(d.heading + clamp(readout.pdi * 1.2, -0.15, 0.15));
        } else {
            heading = world.nav.courseToSteer ?? bearing(world.aircraft.position, target.aim);
        }

        this.fly(
            world,
            {
                heading,
                maxBank: (12 * Math.PI) / 180,
                altitude: ref.refAltitude ?? d.altitude,
                maxVerticalSpeed: 3,
                airspeed: ref.refIas ?? d.indicatedAirspeed,
                gearDown: false,
                flaps: 0,
            },
            dt,
        );
    }

    private updateLanding(world: MissionWorld, dt: number): void {
        const a = world.aircraft;
        const d = world.derived();
        const r = world.runway;

        if (this.landing === null) {
            // Выход на посадочную прямую через точку final, затем заход по глиссаде.
            const fix = world.waypoint('final');
            const fixPos = fix?.position ?? { x: r.x - Math.sin(r.heading) * 9000, y: r.y - Math.cos(r.heading) * 9000, z: r.elevation_m + 480 };
            const toFix = distance2(a.position, fixPos);

            if (toFix > 2000 && a.contact === 'air') {
                const gear = toFix < 6000;

                this.fly(world, { heading: bearing(a.position, fixPos), altitude: fixPos.z, maxVerticalSpeed: 6, airspeed: 72, gearDown: gear && !a.modifiers.gearFailed, flaps: gear ? 0.4 : 0 }, dt);

                return;
            }

            this.landing = new CircuitPilot(defaultCircuit(r), a.contact === 'air' ? 'final' : 'rollout');
        }

        const input = this.landing.update(a, d, dt);

        // Шасси не выпускается — посадка на фюзеляж: без шасси, закрылки полностью.
        if (a.modifiers.gearFailed) {
            input.gearDown = false;
        }

        this.apply(world, input);
    }

    get landingPhase(): string | null {
        return this.landing?.phase ?? this.takeoff?.phase ?? null;
    }
}

/** ИИ пилота: пилотирует, если управление у него. */
export class PilotAI {
    readonly flight = new FlightLogic('pilot');

    update(world: MissionWorld, dt: number): void {
        if (world.crew.flyingStation === 'pilot' && isActive(world.member('pilot'))) {
            this.flight.update(world, dt);
        }

        // Подтверждение передачи управления, если второй пилот попросил.
        if (world.crew.takeControlRequestedTick !== null && world.member('pilot').health !== 'ok') {
            world.act('pilot', { type: 'confirm_handover' });
        }
    }
}
