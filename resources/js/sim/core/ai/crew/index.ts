import type { Station } from '../../config';
import type { StationAI, StationAIFactory } from '../../world';
import { BombardierAI } from './bombardier';
import { CopilotAI } from './copilot';
import { PilotAI } from './flight';
import { GunnerAI } from './gunner';
import { NavigatorAI } from './navigator';
import { RadioAI } from './radio';

/**
 * ИИ-заместители всех восьми станций (раздел 6, 8.4): каждый выполняет задачи своего места
 * теми же командами, что и игрок.
 */
export const createCrewAI: StationAIFactory = (station: Station, world): StationAI | null => {
    switch (station) {
        case 'pilot':
            return new PilotAI();
        case 'copilot':
            return CopilotAI.forWorld(world);
        case 'bombardier': {
            const bombing = new BombardierAI(world);
            const nose = new GunnerAI('bombardier', world);

            return {
                update(w, dt) {
                    bombing.update(w, dt);

                    if (w.phase !== 'bomb_run') {
                        nose.update(w, dt);
                    }
                },
            };
        }
        case 'navigator':
            return new NavigatorAI(world);
        case 'radio':
            return new RadioAI(world);
        case 'top_gunner':
        case 'waist_gunner':
        case 'tail_gunner':
            return new GunnerAI(station, world);
    }
};

export { BombardierAI } from './bombardier';
export { CopilotAI } from './copilot';
export { FlightLogic, PilotAI } from './flight';
export { GunnerAI } from './gunner';
export { NavigatorAI } from './navigator';
export { RadioAI } from './radio';
export { SKILL_PROFILES } from './skill';
