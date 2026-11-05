import type { ChecklistId } from '../../checklists';
import { CHECKLISTS } from '../../checklists';
import { isActive } from '../../crew';
import type { MissionWorld } from '../../world';
import { FlightLogic } from './flight';
import { Reaction, SKILL_PROFILES } from './skill';

/**
 * ИИ второго пилота (раздел 6.2): чек-листы, запуск двигателей по шагам автомата,
 * режимы винтов и створки капотов, выполнение приказов пилота (шасси, закрылки),
 * флюгирование и огнетушители, приём управления при ранении пилота.
 */
const CRUISE_PROP = (2300 - 1200) / (2600 - 1200);

type StartStep = 'idle' | 'prime' | 'crank' | 'wait' | 'done';

export class CopilotAI {
    readonly flight = new FlightLogic('copilot');
    private startEngine: 0 | 1 = 0;
    private startStep: StartStep = 'idle';
    private stepTimerS = 0;
    private checklistTimerS = 0;
    private readonly orderReaction: Reaction;
    private readonly failureReaction: [Reaction, Reaction];
    private readonly fireReaction: [Reaction, Reaction];
    private handled: [boolean, boolean] = [false, false];

    constructor(private readonly reactionS: number) {
        this.orderReaction = new Reaction(reactionS * 0.7);
        this.failureReaction = [new Reaction(reactionS * 2), new Reaction(reactionS * 2)];
        this.fireReaction = [new Reaction(reactionS * 1.5), new Reaction(reactionS * 1.5)];
    }

    static forWorld(world: MissionWorld): CopilotAI {
        return new CopilotAI(SKILL_PROFILES[world.member('copilot').skill].reactionS);
    }

    update(world: MissionWorld, dt: number): void {
        if (world.crew.flyingStation === 'copilot') {
            this.flight.update(world, dt);
        }

        this.runChecklists(world, dt);
        this.startEngines(world, dt);
        this.followOrders(world, dt);
        this.manageEngines(world);
        this.emergencies(world, dt);
    }

    /** Отметка пунктов по одному с паузой, как человек с карточкой. */
    private runChecklists(world: MissionWorld, dt: number): void {
        this.checklistTimerS -= dt;

        if (this.checklistTimerS > 0) {
            return;
        }

        const lists: ChecklistId[] =
            world.phase === 'preflight' ? ['preflight', 'start'] : world.phase === 'takeoff' ? ['takeoff'] : world.phase === 'landing' ? ['landing'] : [];

        for (const list of lists) {
            for (const item of CHECKLISTS[list]) {
                if (!world.checklists[list][item.id] && item.check(world.aircraft, { oxygenOn: world.crew.oxygenOn })) {
                    world.act('copilot', { type: 'checklist', list, item: item.id });
                    this.checklistTimerS = this.reactionS;

                    return;
                }
            }
        }
    }

    /** Запуск: аккумулятор → насос → праймер → стартер → магнето → смесь (раздел 6.2). */
    private startEngines(world: MissionWorld, dt: number): void {
        const a = world.aircraft;
        const c = world.copilot;

        if (world.phase !== 'preflight' || a.engines.every((e) => e.mode === 'running')) {
            c.starter = [false, false];
            c.primer = [false, false];

            return;
        }

        if (!c.battery) {
            world.act('copilot', { type: 'battery', on: true });
        }

        if (!c.fuelPump) {
            world.act('copilot', { type: 'fuel_pump', on: true });
        }

        const i = this.startEngine;

        this.stepTimerS += dt;

        switch (this.startStep) {
            case 'idle':
                if (a.engines[i].mode === 'running') {
                    this.startEngine = 1;
                } else {
                    this.startStep = 'prime';
                    this.stepTimerS = 0;
                    world.say('copilot', 'intercom.starting_engine', { side: i === 0 ? 'left' : 'right' });
                }
                break;
            case 'prime':
                c.primer[i] = true;

                if (this.stepTimerS > 1.2) {
                    c.primer[i] = false;
                    this.startStep = 'crank';
                    this.stepTimerS = 0;
                }
                break;
            case 'crank':
                c.starter[i] = true;

                if (this.stepTimerS > 1) {
                    c.magnetos[i] = true;
                    c.mixture[i] = 1;
                    this.startStep = 'wait';
                    this.stepTimerS = 0;
                }
                break;
            case 'wait':
                if (a.engines[i].mode === 'running') {
                    c.starter[i] = false;
                    this.startStep = 'idle';
                    this.startEngine = i === 0 ? 1 : 0;
                } else if (this.stepTimerS > 8) {
                    // Не запустился — повторяем с праймера.
                    c.starter[i] = false;
                    this.startStep = 'prime';
                    this.stepTimerS = 0;
                }
                break;
            case 'done':
                break;
        }
    }

    private followOrders(world: MissionWorld, dt: number): void {
        const o = world.orders;
        const c = world.copilot;
        const pending = (o.gearDown !== null && o.gearDown !== c.gearDown) || (o.flaps !== null && o.flaps !== c.flaps);

        if (this.orderReaction.update(pending, dt)) {
            if (o.gearDown !== null && o.gearDown !== c.gearDown) {
                c.gearDown = o.gearDown;
                world.say('copilot', o.gearDown ? 'intercom.gear_down_ack' : 'intercom.gear_up_ack');
            }

            if (o.flaps !== null) {
                c.flaps = o.flaps;
            }

            this.orderReaction.reset();
        }
    }

    /** Обороты по фазе и температура головок цилиндров створками капотов. */
    private manageEngines(world: MissionWorld): void {
        const c = world.copilot;
        const phase = world.phase;
        const prop = phase === 'preflight' || phase === 'takeoff' || phase === 'landing' || phase === 'bomb_run' ? 1 : CRUISE_PROP;

        world.aircraft.engines.forEach((e, i) => {
            if (c.feather[i] === true) {
                return;
            }

            c.prop[i] = prop;
            c.cowl[i] = e.chtC > 215 ? 1 : e.chtC < 180 ? 0.2 : (c.cowl[i] ?? 0.5);
        });
    }

    private emergencies(world: MissionWorld, dt: number): void {
        const a = world.aircraft;
        const c = world.copilot;

        for (const i of [0, 1] as const) {
            const engine = a.engines[i];
            const failedEngine = engine.mode === 'failed' || a.engineFailed[i];

            // Отказ — флюгировать винт и перекрыть смесь.
            if (this.failureReaction[i].update(failedEngine && !engine.feathered && !this.handled[i], dt)) {
                c.feather[i] = true;
                c.mixture[i] = 0;
                this.handled[i] = true;
                world.say('copilot', 'intercom.feathered', { side: i === 0 ? 'left' : 'right' });
            }

            // Пожар — флюгер и отсечка, затем огнетушитель (с зафлюгированным винтом надёжнее).
            if (this.fireReaction[i].update(world.damage.engineFireS[i] !== null, dt)) {
                c.feather[i] = true;
                c.mixture[i] = 0;

                if (engine.feathered && world.damage.extinguishers[i]) {
                    world.act('copilot', { type: 'extinguish', index: i });
                    this.fireReaction[i].reset();
                }
            }
        }

        // Пилот выбыл — «Взял управление».
        if (!isActive(world.member('pilot')) && world.crew.flyingStation === 'pilot' && world.crew.takeControlRequestedTick === null) {
            world.act('copilot', { type: 'take_control' });
        }
    }
}
