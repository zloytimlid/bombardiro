import { describe, expect, it } from 'vitest';
import { engineSampleUrl, samplePlaybackRate, SAMPLE_REFERENCE_RPM, seamlessLoop, steadiestWindow } from './engineSample';

const RATE = 1000;

/** Сигнал с заданной огибающей по секундам: синус 50 Гц с амплитудой envelope[t]. */
function signal(envelope: number[]): Float32Array {
    const out = new Float32Array(envelope.length * RATE);

    for (let i = 0; i < out.length; i++) {
        out[i] = envelope[Math.floor(i / RATE)]! * Math.sin((2 * Math.PI * 50 * i) / RATE);
    }

    return out;
}

describe('engine recording', () => {
    it('picks the steady loud stretch of a fly-by recording, not the peak or the silence', () => {
        // Тишина, резкий пик пролёта, ровный громкий участок 20–30 с, спад.
        const envelope = [
            ...Array(5).fill(0.01),
            0.2, 0.9, 0.3,
            ...Array(12).fill(0.02),
            ...Array(10).fill(0.4),
            ...Array(5).fill(0.05),
        ];
        const w = steadiestWindow(signal(envelope), RATE, 8, 0.5);

        expect(w.startS).toBeGreaterThanOrEqual(20);
        expect(w.endS).toBeLessThanOrEqual(30);
        expect(w.endS - w.startS).toBe(8);
        expect(w.rms).toBeCloseTo(0.4 / Math.SQRT2, 2);
    });

    it('builds a loop whose end runs straight into its start (no click at the seam)', () => {
        const source = new Float32Array(10000).map((_, i) => Math.sin(i / 37) + 0.3 * Math.sin(i / 11));
        const [loop] = seamlessLoop([source], 1000, 9000, 500);

        expect(loop!.length).toBe(7500);
        // Последний отсчёт петли и первый — соседние отсчёты исходника: шаг на стыке как обычный шаг сигнала.
        const seam = Math.abs(loop![0]! - loop![loop!.length - 1]!);
        let typical = 0;

        for (let i = 1; i < 2000; i++) {
            typical = Math.max(typical, Math.abs(source[i]! - source[i - 1]!));
        }

        expect(seam).toBeLessThanOrEqual(typical * 1.01);
    });

    it('follows engine RPM with the playback rate, within limits', () => {
        expect(samplePlaybackRate(SAMPLE_REFERENCE_RPM)).toBe(1);
        expect(samplePlaybackRate(2600)).toBeGreaterThan(1);
        expect(samplePlaybackRate(0)).toBe(0.35);
        expect(samplePlaybackRate(10000)).toBe(1.45);
    });

    it('uses the first recording in the folder, or none', () => {
        expect(engineSampleUrl({ 'b.mp3': '/b', 'a.ogg': '/a' })).toBe('/a');
        expect(engineSampleUrl({})).toBeNull();
    });
});
