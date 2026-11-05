import { isAvailable } from '../../crew';
import { activeTransmissions } from '../../radio';
import type { MissionWorld } from '../../world';
import { GunnerAI } from './gunner';
import type { CrewSkillProfile } from './skill';
import { SKILL_PROFILES } from './skill';

/**
 * ИИ радиста (раздел 6.5): ищет передачу по шуму и подстраивает частоту, расшифровывает
 * принятые группы по кодовой таблице (с ошибкой по уровню), включает «свой-чужой» на возврате,
 * подаёт сигнал бедствия; в бою — левый бортовой пулемёт.
 */
export class RadioAI {
    private readonly profile: CrewSkillProfile;
    private readonly gun: GunnerAI;
    private tuneTimerS = 0;
    private decodeTimerS = 0;

    constructor(world: MissionWorld) {
        this.profile = SKILL_PROFILES[world.member('radio').skill];
        this.gun = new GunnerAI('radio', world);
    }

    update(world: MissionWorld, dt: number): void {
        const radio = world.radio;

        if (!isAvailable(world.member('radio'))) {
            return;
        }

        // Поиск сигнала: услышал передачу в эфире — крутит ручку на неё.
        const active = activeTransmissions(radio, world.tick);
        const best = active[0];

        if (best !== undefined && Math.abs(radio.dialMhz - best.frequencyMhz) > 0.01) {
            this.tuneTimerS += dt;

            if (this.tuneTimerS > this.profile.reactionS * 2) {
                world.act('radio', { type: 'radio_dial', mhz: best.frequencyMhz + world.rng.gaussian(0, 0.008) });
                this.tuneTimerS = 0;
            }
        } else {
            this.tuneTimerS = 0;
        }

        // Расшифровка по кодовой таблице дня.
        const pending = radio.received.find((r) => r.decoded === null);

        if (pending) {
            this.decodeTimerS += dt;

            if (this.decodeTimerS > this.profile.reactionS * 5) {
                const table = world.mission.radio.code_table;
                const truth = table.find((c) => c.group === pending.group)?.meaning;
                const wrong = world.rng.chance(this.profile.decodeErrorChance) || truth === undefined;
                const meaning = wrong ? (table[Math.floor(world.rng.next() * table.length)]?.meaning ?? 'weather_clear') : truth;

                world.act('radio', { type: 'decode', messageId: pending.messageId, meaning });
                this.decodeTimerS = 0;
            }
        }

        // «Свой-чужой» на возврате или по напоминанию базы.
        const reminded = radio.received.some((r) => r.decoded === 'iff_reminder');

        if ((world.phase === 'return' || world.phase === 'landing' || reminded) && !radio.iff) {
            world.act('radio', { type: 'iff', on: true });
            world.say('radio', 'intercom.iff_on');
        }

        if (world.crew.bailOutOrdered && !radio.distressSent) {
            world.act('radio', { type: 'distress' });
        }

        if (best === undefined && pending === undefined) {
            this.gun.update(world, dt);
        }
    }
}
