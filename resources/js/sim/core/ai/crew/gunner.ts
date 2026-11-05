import type { Station } from '../../config';
import { clockOf, isAvailable } from '../../crew';
import { failed } from '../../damage';
import type { Fighter } from '../../fighters';
import { azElOf, clampToArc, inNoFireZone, leadDirection } from '../../guns';
import { add, length, rotate, rotateInverse, sub, vec } from '../../math';
import { TICK_HZ } from '../../simulation';
import type { MissionWorld } from '../../world';
import type { CrewSkillProfile } from './skill';
import { Reaction, SKILL_PROFILES } from './skill';

/**
 * ИИ стрелков (раздел 6.6): выбор цели в секторе, упреждение, очереди без перегрева,
 * устранение задержек, доклады по часовой системе. Плюс обязанности мест:
 * верхняя турель — бортинженер, бортовой — первая помощь, хвостовой — доклад о разрывах.
 */
const OPEN_FIRE_M = 850;
const REPORT_RANGE_M = 4000;
const BULLET_SPEED = 820;

export class GunnerAI {
    private readonly profile: CrewSkillProfile;
    private readonly reported = new Set<number>();
    private readonly seen = new Map<number, number>();
    private burstS = 0;
    private pauseS = 0;
    private aimNoise = { az: 0, el: 0 };
    private noiseTimerS = 0;
    private readonly taskReaction: Reaction;
    private reportedImpacts = 0;
    private gearCranked = false;
    private transferred = false;

    constructor(
        private readonly station: Station,
        world: MissionWorld,
    ) {
        this.profile = SKILL_PROFILES[world.member(station).skill];
        this.taskReaction = new Reaction(this.profile.reactionS * 2);
    }

    update(world: MissionWorld, dt: number): void {
        const member = world.member(this.station);

        this.duties(world, dt);

        if (!isAvailable(member)) {
            return;
        }

        this.report(world);
        this.shoot(world, dt);
    }

    private mounts(world: MissionWorld) {
        return world.mounts.filter((m) => m.station === this.station && !m.fixed);
    }

    private relative(world: MissionWorld, f: Fighter, mountPosition: readonly number[]): { pos: ReturnType<typeof vec>; vel: ReturnType<typeof vec> } {
        const a = world.aircraft;
        const origin = add(a.position, rotate(a.attitude, vec(mountPosition[0] ?? 0, mountPosition[1] ?? 0, mountPosition[2] ?? 0)));

        return { pos: sub(f.position, origin), vel: sub(f.velocity, a.velocity) };
    }

    private shoot(world: MissionWorld, dt: number): void {
        const a = world.aircraft;
        const cfgs = world.config.gameplay_mounts.value;

        this.noiseTimerS -= dt;

        if (this.noiseTimerS <= 0) {
            const sigma = (this.profile.aimErrorMrad / 1000) / Math.max(world.member(this.station).efficiency, 0.3);

            this.aimNoise = { az: world.rng.gaussian(0, sigma), el: world.rng.gaussian(0, sigma) };
            this.noiseTimerS = 0.6;
        }

        for (const mount of this.mounts(world)) {
            const cfg = cfgs[mount.id];

            if (cfg === undefined) {
                continue;
            }

            let best: { f: Fighter; az: number; el: number; range: number } | null = null;

            for (const f of world.fighters) {
                if (f.phase === 'down') {
                    continue;
                }

                const rel = this.relative(world, f, cfg.position_m);
                const range = length(rel.pos);

                if (range > 1400) {
                    continue;
                }

                const lead = leadDirection(rel.pos, rel.vel, BULLET_SPEED);

                if (lead === null) {
                    continue;
                }

                const { az, el } = azElOf(rotateInverse(a.attitude, lead.dir));
                const clamped = clampToArc(cfg, az, el);

                if (Math.abs(clamped.az - az) > 0.02 || Math.abs(clamped.el - el) > 0.02 || inNoFireZone(cfg, az, el)) {
                    continue;
                }

                if (best === null || range < best.range) {
                    best = { f, az, el, range };
                }
            }

            const command = world.mountCommands[mount.id] ?? { fire: false, clearJam: false };

            if (mount.jammed) {
                world.mountCommands[mount.id] = { ...command, fire: false, clearJam: true };

                continue;
            }

            if (best === null) {
                world.mountCommands[mount.id] = { az: cfg.az_center_deg * (Math.PI / 180), el: 0.1, fire: false, clearJam: false };

                continue;
            }

            const az = best.az + this.aimNoise.az;
            const el = best.el + this.aimNoise.el;
            const onTarget = Math.abs(mount.az - az) < 0.03 && Math.abs(mount.el - el) < 0.03;

            // Очереди: огонь до перегрева, короткие паузы.
            let fire = onTarget && best.range < OPEN_FIRE_M && mount.heat < 0.65;

            if (fire) {
                this.burstS += dt;

                if (this.burstS > 1.6) {
                    this.pauseS = 0.5;
                    this.burstS = 0;
                }
            }

            if (this.pauseS > 0) {
                this.pauseS -= dt;
                fire = false;
            }

            world.mountCommands[mount.id] = { az, el, fire, clearJam: false };
        }
    }

    /** Доклады об истребителях по часовой системе с задержкой реакции. */
    private report(world: MissionWorld): void {
        const a = world.aircraft;

        for (const f of world.fighters) {
            if (f.phase === 'down' || this.reported.has(f.id)) {
                continue;
            }

            const rel = sub(f.position, a.position);
            const range = length(rel);

            if (range > REPORT_RANGE_M) {
                continue;
            }

            const first = this.seen.get(f.id) ?? world.tick;

            this.seen.set(f.id, first);

            // Каждый докладывает о своей полусфере; кто-то обязательно увидит.
            const body = rotateInverse(a.attitude, rel);
            const az = Math.atan2(body.y, body.x);
            const mine =
                this.station === 'top_gunner' ||
                (this.station === 'tail_gunner' && Math.abs(az) > 2) ||
                (this.station === 'waist_gunner' && az > 0.3) ||
                (this.station === 'radio' && az < -0.3) ||
                (this.station === 'bombardier' && Math.abs(az) < 0.9);

            if (!mine || (world.tick - first) / TICK_HZ < this.profile.reactionS) {
                continue;
            }

            if (world.crew.threats.some((t) => t.clock === clockOf(az) && t.kind === 'fighter')) {
                this.reported.add(f.id);
                continue;
            }

            const level = -body.z > 150 ? 'high' : -body.z < -150 ? 'low' : 'level';

            world.act(this.station, { type: 'report_threat', clock: clockOf(az), level, kind: 'fighter' });
            this.reported.add(f.id);
        }
    }

    /** Обязанности места помимо пулемёта. */
    private duties(world: MissionWorld, dt: number): void {
        const member = world.member(this.station);
        const fightersClose = world.fighters.some((f) => f.phase !== 'down' && length(sub(f.position, world.aircraft.position)) < 3000);

        if (this.station === 'top_gunner') {
            // Пожар внутри — тушить сразу, даже если турель останется пустой.
            if (this.taskReaction.update(world.damage.fuselageFire && member.task === null, dt)) {
                world.act('top_gunner', { type: 'task', kind: 'extinguish' });
            }

            const a = world.aircraft;
            const needGear = (world.phase === 'landing' || world.phase === 'return') && a.hydraulicPressure < 0.3 && a.gear < 0.9 && !this.gearCranked && !a.modifiers.gearFailed;

            if (needGear && member.task === null) {
                this.gearCranked = true;
                world.act('top_gunner', { type: 'task', kind: 'emergency_gear' });
            }

            const leaking = world.damage.bigLeaks.some((l) => l > 0);

            if (leaking && !this.transferred && member.task === null && !fightersClose) {
                this.transferred = true;
                world.act('top_gunner', { type: 'task', kind: 'fuel_transfer' });
            }
        }

        if (this.station === 'waist_gunner' && member.task === null && !fightersClose) {
            const patient = Object.values(world.crew.members).find((m) => m.health === 'wounded' && !m.treated && !m.bailedOut && m.station !== 'waist_gunner');

            if (patient) {
                world.act('waist_gunner', { type: 'task', kind: 'first_aid', target: patient.station });
            }
        }

        // Хвостовой стрелок первым видит разрывы — доклад о результате бомбометания.
        if (this.station === 'tail_gunner' && world.impacts.length > this.reportedImpacts && world.bombs.length === 0 && world.releaseQueue.length === 0) {
            const fresh = world.impacts.slice(this.reportedImpacts);
            const onTarget = fresh.filter((i) => i.onTarget).length;
            const avgMiss = fresh.reduce((s, i) => s + i.missM, 0) / fresh.length;

            this.reportedImpacts = world.impacts.length;
            world.say('tail_gunner', onTarget > 0 ? 'intercom.hits_on_target' : 'intercom.bombs_missed', { count: onTarget, miss: Math.round(avgMiss) });
            world.event('bomb_report', { onTarget, avgMiss: Math.round(avgMiss) });
        }

        void failed;
    }
}
