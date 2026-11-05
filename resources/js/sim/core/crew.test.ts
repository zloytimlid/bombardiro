import { describe, expect, it } from 'vitest';
import { CHECKLISTS, checkItem, createChecklists, missedItems } from './checklists';
import { addThreat, clockOf, createCrew, expireThreats, treat, wound } from './crew';
import { vec } from './math';
import { bearing, fromEnu, toEnu } from './mission/geo';
import { courseToSteer, createNavigator, radioCompassBearing, solveWind, stepDeadReckoning } from './navigation';
import { createRadio, decode, noiseLevel, signalStrength, stepRadio, transmit } from './radio';
import { Rng } from './rng';
import { milkRun, milkRunWorld } from './testing';

describe('crew', () => {
    it('a light wound slows the station, a second one takes the member out; first aid helps', () => {
        const crew = createCrew('experienced', ['pilot']);

        expect(crew.members.pilot.controller).toBe('human');
        expect(crew.members.copilot.controller).toBe('ai');

        wound(crew, 'radio', false, 0);
        expect(crew.members.radio.health).toBe('wounded');
        expect(crew.members.radio.efficiency).toBeLessThan(0.6);

        treat(crew, 'radio');
        expect(crew.members.radio.efficiency).toBeGreaterThan(0.75);

        wound(crew, 'radio', false, 1);
        expect(crew.members.radio.health).toBe('incapacitated');
        expect(crew.intercom.some((m) => m.key === 'intercom.crew_down')).toBe(true);
    });

    it('clock positions and threat markers expire after 10 s', () => {
        expect(clockOf(0)).toBe(12);
        expect(clockOf(Math.PI / 2)).toBe(3);
        expect(clockOf(Math.PI)).toBe(6);
        expect(clockOf(-Math.PI / 2)).toBe(9);

        const crew = createCrew('veteran');

        addThreat(crew, { clock: 4, level: 'high', kind: 'fighter', reportedBy: 'tail_gunner' }, 0, 600);
        addThreat(crew, { clock: 4, level: 'high', kind: 'fighter', reportedBy: 'waist_gunner' }, 100, 600);
        expect(crew.threats).toHaveLength(1);

        expireThreats(crew, 701);
        expect(crew.threats).toHaveLength(0);
    });

    it('checklist items only count when their condition holds', () => {
        const world = milkRunWorld();
        const lists = createChecklists();

        expect(checkItem(lists, 'start', 'left_engine', world.aircraft, { oxygenOn: true })).toBe(false);
        expect(checkItem(lists, 'preflight', 'battery', world.aircraft, { oxygenOn: true })).toBe(true);
        expect(missedItems(lists, 'preflight')).toBe(CHECKLISTS.preflight.length - 1);
    });
});

describe('navigation', () => {
    it('wind triangle: drift and ground speed give back the wind', () => {
        const heading = 0.3;
        const tas = 100;
        const wind = { x: -6, y: 4 };
        const ground = { x: Math.sin(heading) * tas + wind.x, y: Math.cos(heading) * tas + wind.y };
        const track = Math.atan2(ground.x, ground.y);
        const solved = solveWind(heading, tas, track - heading, Math.hypot(ground.x, ground.y));

        expect(solved.x).toBeCloseTo(wind.x, 6);
        expect(solved.y).toBeCloseTo(wind.y, 6);
    });

    it('course to steer corrects for cross wind so the track goes to the point', () => {
        const wind = { x: 0, y: -10 };
        const sol = courseToSteer({ x: 0, y: 0 }, { x: 10000, y: 0 }, 100, wind);
        const ground = { x: Math.sin(sol.heading) * 100 + wind.x, y: Math.cos(sol.heading) * 100 + wind.y };

        expect(Math.atan2(ground.x, ground.y)).toBeCloseTo(Math.PI / 2, 3);
    });

    it('dead reckoning with the true wind follows the true position', () => {
        const nav = createNavigator({ x: 0, y: 0 }, { x: 3, y: -2 });

        for (let i = 0; i < 600; i++) {
            stepDeadReckoning(nav, Math.PI / 2, 100, 0.1);
        }

        expect(nav.dr.x).toBeCloseTo(6000 + 180, 6);
        expect(nav.dr.y).toBeCloseTo(-120, 6);
    });

    it('lat/lon ↔ ENU round-trip and bearings', () => {
        const origin = { origin_lat: 42.2, origin_lon: 9.5 };
        const p = toEnu(origin, 42.5, 10.1);
        const back = fromEnu(origin, p);

        expect(back.lat).toBeCloseTo(42.5, 6);
        expect(back.lon).toBeCloseTo(10.1, 6);
        expect(bearing({ x: 0, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(Math.PI / 2);
        expect(radioCompassBearing({ x: 0, y: -1000 }, { x: 0, y: 0 }, new Rng(1), 0)).toBeCloseTo(0);
    });

    it('in the historical mode the navigator only has the dead-reckoned position', () => {
        const historical = milkRunWorld({ difficulty: 'historical', humans: ['navigator'], start: { phase: 'route', position: vec(50000, 30000, 3000), heading: 1.5, speedMs: 98, enginesRunning: true, gearDown: false, legIndex: 3 } });
        const training = milkRunWorld({ difficulty: 'training', humans: ['navigator'], start: { phase: 'route', position: vec(50000, 30000, 3000), heading: 1.5, speedMs: 98, enginesRunning: true, gearDown: false, legIndex: 3 } });

        historical.run(60 * 300);
        training.run(60 * 300);

        const err = (w: typeof historical): number => Math.hypot(w.nav.dr.x - w.aircraft.position.x, w.nav.dr.y - w.aircraft.position.y);

        expect(err(training)).toBe(0);
        expect(err(historical)).toBeGreaterThan(0);
    }, 60000);
});

describe('radio', () => {
    const def = milkRun.radio_script[0];

    if (def === undefined) {
        throw new Error('no radio script');
    }

    it('a message is received only on the right frequency', () => {
        const tuned = createRadio();
        const detuned = createRadio();

        tuned.dialMhz = 5.65;
        detuned.dialMhz = 5.2;
        transmit(tuned, def, 5.65, 0, 60);
        transmit(detuned, def, 5.65, 0, 60);

        for (let t = 0; t < 60 * 60; t++) {
            stepRadio(tuned, t, true);
            stepRadio(detuned, t, true);
        }

        expect(tuned.received).toHaveLength(1);
        expect(detuned.received).toHaveLength(0);
        expect(detuned.missed).toBe(1);
        expect(signalStrength(5.65, 5.65)).toBe(1);
    });

    it('noise falls as the dial approaches an active station', () => {
        const radio = createRadio();

        transmit(radio, def, 5.65, 0, 60);
        radio.dialMhz = 4;
        const far = noiseLevel(radio, 10);

        radio.dialMhz = 5.64;
        expect(noiseLevel(radio, 10)).toBeLessThan(far);
    });

    it('decoding against the code table of the day', () => {
        const radio = createRadio();

        radio.dialMhz = 5.65;
        transmit(radio, def, 5.65, 0, 60);

        for (let t = 0; t < 60 * 30; t++) {
            stepRadio(radio, t, true);
        }

        const message = radio.received[0];

        expect(message).toBeDefined();

        if (message) {
            expect(decode(message, 'recall', milkRun.radio.code_table, 100)).toBe(false);
            expect(message.correct).toBe(false);
        }
    });

    it('a decoded recall sends the crew home; an unheard one changes nothing', () => {
        const start = { phase: 'route' as const, position: vec(50000, 30000, 3000), heading: 1.5, speedMs: 98, enginesRunning: true, gearDown: false, legIndex: 3 };
        const recall = { id: 'recall', channel: 'command' as const, group: 'VX-42', meaning: 'recall' as const, duration_s: 10, repeats: 2 };
        const mission = { ...milkRun, threats: { flak: [], fighter_waves: [] }, triggers: [], radio_script: [...milkRun.radio_script, recall] };
        const heard = milkRunWorld({ mission, start, humans: ['radio'] });
        const silent = milkRunWorld({ mission, start, humans: ['radio'] });

        heard.act('radio', { type: 'radio_dial', mhz: 5.65 });
        silent.act('radio', { type: 'radio_dial', mhz: 3.1 });

        for (const w of [heard, silent]) {
            w.runAction({ type: 'send_radio', message: 'recall' });
            w.run(60 * 15);

            // Радист-игрок расшифровывает всё, что принял.
            for (const r of w.radio.received) {
                w.act('radio', { type: 'decode', messageId: r.messageId, meaning: 'recall' });
            }

            w.run(60);
        }

        expect(heard.recallKnown).toBe(true);
        expect(heard.phase).toBe('return');
        expect(silent.recallKnown).toBe(false);
        expect(silent.phase).toBe('route');
    });
});
