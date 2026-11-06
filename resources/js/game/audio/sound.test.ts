import { describe, expect, it } from 'vitest';
import { burstArrival, engineVoice, windGain } from './sound';

describe('sound model (section 12)', () => {
    it('engine pitch follows rpm (7 firings per revolution) and loudness follows manifold pressure', () => {
        const idle = engineVoice(600, 14, 'pilot', -1);
        const climb = engineVoice(2400, 40, 'pilot', -1);

        expect(climb.freq).toBeCloseTo((2400 / 60) * 7, 5);
        expect(climb.gain).toBeGreaterThan(idle.gain);
        expect(engineVoice(0, 30, 'pilot', 1).gain).toBe(0);
    });

    it('pans engines by side and quiets them toward the tail', () => {
        expect(engineVoice(2000, 30, 'pilot', -1).pan).toBeLessThan(0);
        expect(engineVoice(2000, 30, 'pilot', 1).pan).toBeGreaterThan(0);
        expect(engineVoice(2000, 30, 'tail_gunner', 1).gain).toBeLessThan(engineVoice(2000, 30, 'pilot', 1).gain);
        expect(Math.abs(engineVoice(2000, 30, 'tail_gunner', 1).pan)).toBeLessThan(Math.abs(engineVoice(2000, 30, 'pilot', 1).pan));
    });

    it('wind grows with airspeed; flak is heard after the sound travels', () => {
        expect(windGain(100, 'waist_gunner')).toBeGreaterThan(windGain(40, 'waist_gunner'));
        expect(burstArrival(686).delayS).toBeCloseTo(2, 5);
        expect(burstArrival(2000).gain).toBeLessThan(burstArrival(100).gain);
    });
});
