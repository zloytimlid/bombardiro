import { measureDrift } from '../../navigation';
import { wrapPi } from '../../math';
import { distance2 } from '../../mission/geo';
import { TICK_HZ } from '../../simulation';
import type { MissionWorld } from '../../world';
import type { CrewSkillProfile } from './skill';
import { SKILL_PROFILES } from './skill';

/**
 * ИИ штурмана (раздел 6.3): периодически измеряет снос визиром и путевую скорость,
 * решает ветровой треугольник, ставит отметки по ориентирам в пределах видимости.
 * Курс и время рассчитывает «навигационный расчётник» мира по счисленному месту.
 */
const DRIFT_PERIOD_S = 240;
const FIX_PERIOD_S = 180;

export class NavigatorAI {
    private readonly profile: CrewSkillProfile;
    private nextDriftS = 60;
    private readonly fixed = new Set<string>();

    constructor(world: MissionWorld) {
        this.profile = SKILL_PROFILES[world.member('navigator').skill];
    }

    update(world: MissionWorld, dt: number): void {
        void dt;

        const a = world.aircraft;

        if (a.contact !== 'air' || world.difficulty === 'training') {
            return;
        }

        const d = world.derived();
        const eff = Math.max(world.member('navigator').efficiency, 0.3);

        // Снос и путевая скорость — на прямолинейном участке.
        if (world.timeS >= this.nextDriftS && Math.abs(d.roll) < 0.08) {
            const track = Math.atan2(a.velocity.x, a.velocity.y);
            const gs = Math.hypot(a.velocity.x, a.velocity.y);
            const drift = measureDrift(wrapPi(track - d.heading), world.rng, this.profile.driftErrorRad / eff);
            const gsMeasured = gs * (1 + world.rng.gaussian(0, this.profile.groundSpeedErrorShare / eff));

            world.act('navigator', { type: 'nav_drift', driftRad: drift, groundSpeedMs: gsMeasured });
            world.say('navigator', 'intercom.drift_measured', { drift: Math.round((drift * 180) / Math.PI) });
            this.nextDriftS = world.timeS + DRIFT_PERIOD_S;
        }

        // Отметка по ориентиру, когда он рядом (берег, мыс, город).
        const sinceFix = world.nav.lastFixTick === null ? Infinity : (world.tick - world.nav.lastFixTick) / TICK_HZ;

        if (sinceFix > FIX_PERIOD_S) {
            const range = Math.min(world.visualRange(), 6000);
            const landmark = world.landmarks.find((l) => !this.fixed.has(l.id) && distance2(l.position, a.position) < range * 0.6);

            if (landmark) {
                this.fixed.add(landmark.id);
                world.act('navigator', { type: 'nav_fix', landmark: landmark.id });
            }
        }
    }
}
