import { toTrackFrame } from '../../bombsight';
import { failed } from '../../damage';
import { wrapPi } from '../../math';
import type { MissionWorld } from '../../world';
import type { CrewSkillProfile } from './skill';
import { SKILL_PROFILES } from './skill';

/**
 * ИИ бомбардира (раздел 6.4): взведение, настройка прицела, люк, синхронизация «скорость/снос»
 * с инерцией и остаточной ошибкой по уровню, автоматический сброс, а при отказе прицела — «на глаз».
 */
export class BombardierAI {
    private readonly profile: CrewSkillProfile;
    private rateBias = 0;
    private driftBias = 0;
    private altitudeBias = 0;
    private eyeballBias = 0;
    private setup = false;
    private closedAfter = false;

    constructor(world: MissionWorld) {
        this.profile = SKILL_PROFILES[world.member('bombardier').skill];
        this.rateBias = world.rng.gaussian(0, this.profile.syncRateBias);
        this.driftBias = world.rng.gaussian(0, this.profile.syncDriftBiasRad);
        this.altitudeBias = world.rng.gaussian(0, this.profile.altitudeErrorShare);
        this.eyeballBias = world.rng.gaussian(0, this.profile.eyeballErrorShare);
    }

    update(world: MissionWorld, dt: number): void {
        const sight = world.sight;
        const phase = world.phase;

        if ((phase === 'route' || phase === 'formup') && !sight.armed && world.rack.length > 0) {
            world.act('bombardier', { type: 'arm', on: true });
            world.act('bombardier', { type: 'release_mode', mode: 'train', intervalMs: 120 });
            world.say('bombardier', 'intercom.fuzes_armed');
        }

        if (phase !== 'bomb_run') {
            if (world.doorsCommand && world.rack.length === 0 && world.releaseQueue.length === 0 && !this.closedAfter) {
                this.closedAfter = true;
                world.act('bombardier', { type: 'doors', open: false });
            }

            return;
        }

        if (world.rack.length === 0) {
            if (world.releaseQueue.length === 0 && world.doorsCommand && world.bombs.length === 0) {
                world.act('bombardier', { type: 'doors', open: false });
                this.closedAfter = true;
            }

            return;
        }

        if (!world.doorsCommand) {
            world.act('bombardier', { type: 'doors', open: true });
            world.say('bombardier', 'intercom.doors_open');
        }

        const a = world.aircraft;
        const d = world.derived();
        const target = world.knownTarget();
        const toTarget = { x: target.aim.x - a.position.x, y: target.aim.y - a.position.y };

        if (failed(world.damage, 'bombsight')) {
            this.dropByEye(world, toTarget);

            return;
        }

        const groundVel = { x: a.velocity.x, y: a.velocity.y };
        const gs = Math.hypot(groundVel.x, groundVel.y);
        const trueDrift = wrapPi(Math.atan2(groundVel.x, groundVel.y) - d.heading);

        if (!this.setup) {
            this.setup = true;
            world.act('bombardier', {
                type: 'sight_set',
                altitudeM: (d.altitude - target.aim.z) * (1 + this.altitudeBias),
                tasMs: d.trueAirspeed,
            });
            world.act('bombardier', { type: 'sight_on' });
        }

        // Синхронизация: ручки сходятся к истине с постоянной времени навыка.
        const k = Math.min(1, dt / this.profile.syncTauS);
        const eff = Math.max(world.member('bombardier').efficiency, 0.3);
        const rateGoal = gs * (1 + this.rateBias / eff);
        const driftGoal = trueDrift + this.driftBias / eff;

        world.act('bombardier', { type: 'sight_adjust', rate: (rateGoal - sight.rateMs) * k * 3, drift: (driftGoal - sight.driftRad) * k * 3 });

        // Перекрестье — на точку прицеливания (смещение видно в окуляре).
        const readout = world.sightReadout();

        if (readout?.error) {
            world.act('bombardier', { type: 'sight_adjust', along: readout.error.along * k * 2, across: readout.error.across * k * 2 });
        }

        // Уточнение истинной скорости по прибору.
        if (Math.abs(sight.tasSetMs - d.trueAirspeed) > 2) {
            world.act('bombardier', { type: 'sight_set', tasMs: d.trueAirspeed });
        }
    }

    /** Отказ прицела: дальность сброса по высоте и скорости «на глаз» (раздел 7.3). */
    private dropByEye(world: MissionWorld, toTarget: { x: number; y: number }): void {
        const d = world.derived();
        const target = world.knownTarget();
        const height = Math.max(d.altitude - target.aim.z, 300);
        const range = d.trueAirspeed * Math.sqrt((2 * height) / 9.81) * 0.93 * (1 + this.eyeballBias);
        const track = Math.atan2(world.aircraft.velocity.x, world.aircraft.velocity.y);
        const along = toTrackFrame(toTarget, track).along;

        if (along > 0 && along <= range + world.trainSpreadM()) {
            world.act('bombardier', { type: 'release' });
        }
    }
}
