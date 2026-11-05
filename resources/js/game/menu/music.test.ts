import { describe, expect, it } from 'vitest';
import { menuTracks, shuffle, trackTitle } from './music';

describe('menu music playlist', () => {
    it('builds titles from file names', () => {
        expect(trackTitle('../../../audio/menu/01-morning_patrol.mp3')).toBe('morning patrol');
        expect(trackTitle('/x/Alesan Dawn.ogg')).toBe('Alesan Dawn');
    });

    it('lists every file in the folder, sorted', () => {
        const tracks = menuTracks({ 'b.ogg': '/b', 'a.mp3': '/a' });

        expect(tracks.map((t) => t.url)).toEqual(['/a', '/b']);
    });

    it('shuffles without losing tracks', () => {
        const items = [1, 2, 3, 4, 5];
        let seed = 7;
        const random = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);

        expect(shuffle(items, random).sort()).toEqual(items);
    });
});
