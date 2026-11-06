import { describe, expect, it } from 'vitest';
import { inputPrefsFrom, withDefaults } from '../settings';
import { codeLabel, DEFAULT_BINDINGS, indexBindings, resolveBindings, shapeAxis } from './bindings';

describe('key remapping and gamepad axes (section 12)', () => {
    it('keeps defaults for unknown or broken entries and caps two codes per action', () => {
        const b = resolveBindings({ gear: ['KeyL', 'gp:b3', 'KeyM'], nonsense: ['KeyQ'], flaps: 'KeyF' as unknown as string[] });

        expect(b.gear).toEqual(['KeyL', 'gp:b3']);
        expect(b.flaps).toEqual(DEFAULT_BINDINGS.flaps);
        expect('nonsense' in b).toBe(false);
    });

    it('lets one key mean different things at different stations', () => {
        const index = indexBindings(resolveBindings(null));

        expect(index.get('Space')).toEqual(expect.arrayContaining(['fire_fixed', 'release', 'position_report']));
        expect(index.get('KeyR')).toEqual(expect.arrayContaining(['arm', 'clear_jam']));
    });

    it('applies the dead zone and the response curve, keeping the sign', () => {
        expect(shapeAxis(0.05, 0.08, 1.6)).toBe(0);
        expect(shapeAxis(1, 0.08, 1.6)).toBe(1);
        expect(shapeAxis(-1, 0.08, 1.6)).toBe(-1);
        expect(shapeAxis(0.5, 0.08, 2)).toBeCloseTo(((0.5 - 0.08) / 0.92) ** 2, 6);
        expect(Math.abs(shapeAxis(0.5, 0.08, 2))).toBeLessThan(Math.abs(shapeAxis(0.5, 0.08, 1)));
    });

    it('builds input preferences from stored settings', () => {
        const prefs = inputPrefsFrom(withDefaults({ invert_y: true, long_actions: 'toggle', gamepad_axes: { throttle: { index: 3, invert: true } }, bindings: { brakes: ['Space'] } }));

        expect(prefs.invertY).toBe(true);
        expect(prefs.longActions).toBe('toggle');
        expect(prefs.axes).toEqual({ throttle: { index: 3, invert: true } });
        expect(prefs.bindings.brakes).toEqual(['Space']);
        expect(inputPrefsFrom(withDefaults(null)).axes.pitch).toEqual({ index: 1, invert: false });
    });

    it('labels keys and gamepad controls for the settings screen', () => {
        expect(codeLabel('KeyW')).toBe('W');
        expect(codeLabel('gp:b0')).toBe('Gamepad 1');
        expect(codeLabel('gp:a2-')).toBe('Axis 3-');
    });
});
