/**
 * Запись двигателя для звука в игре (раздел 12): файл из `resources/audio/engine/` (локальный, в репозиторий не
 * попадает — права на запись). Готовые записи — обычно серия пролётов с нарастанием и спадом, поэтому для петли
 * берётся самый ровный по громкости громкий участок, шов сглаживается перекрёстным затуханием, громкость
 * приводится к общему уровню. Нет файла — звучит синтез (sound.ts).
 */
const files = import.meta.glob<string>('../../../audio/engine/*.{mp3,ogg,m4a,wav}', { eager: true, query: '?url', import: 'default' });

/** URL записи двигателя или null (первый файл по алфавиту). */
export function engineSampleUrl(source: Record<string, string> = files): string | null {
    const key = Object.keys(source).sort()[0];

    return key === undefined ? null : (source[key] ?? null);
}

/** Обороты, которым соответствует запись при скорости воспроизведения 1 (крейсерский режим R-2600, source: gameplay). */
export const SAMPLE_REFERENCE_RPM = 2100;

/** Скорость воспроизведения записи по оборотам: на малом газе ниже, на взлётном выше; в разумных пределах. */
export function samplePlaybackRate(rpm: number): number {
    return Math.min(1.45, Math.max(0.35, rpm / SAMPLE_REFERENCE_RPM));
}

/**
 * Самый ровный участок длиной windowS среди громких: громкость (RMS) по блокам blockS, окна со средним ≥ половины
 * лучшего, из них — с наименьшим разбросом (коэффициент вариации). Возвращает границы в секундах и средний RMS.
 */
export function steadiestWindow(samples: Float32Array, sampleRate: number, windowS = 8, blockS = 0.5): { startS: number; endS: number; rms: number } {
    const block = Math.max(1, Math.floor(sampleRate * blockS));
    const rms: number[] = [];

    for (let i = 0; i + block <= samples.length; i += block) {
        let sum = 0;

        for (let j = i; j < i + block; j++) {
            sum += samples[j]! * samples[j]!;
        }

        rms.push(Math.sqrt(sum / block));
    }

    const n = Math.max(1, Math.min(rms.length, Math.round(windowS / blockS)));
    const windows: { start: number; mean: number; cv: number }[] = [];

    for (let s = 0; s + n <= rms.length; s++) {
        const part = rms.slice(s, s + n);
        const mean = part.reduce((a, b) => a + b, 0) / n;
        const sd = Math.sqrt(part.reduce((a, b) => a + (b - mean) ** 2, 0) / n);

        windows.push({ start: s, mean, cv: mean > 0 ? sd / mean : Infinity });
    }

    if (windows.length === 0) {
        return { startS: 0, endS: samples.length / sampleRate, rms: 0 };
    }

    const loudest = Math.max(...windows.map((w) => w.mean));
    const best = windows.filter((w) => w.mean >= loudest * 0.5).reduce((a, b) => (b.cv < a.cv ? b : a));

    return { startS: best.start * blockS, endS: (best.start + n) * blockS, rms: best.mean };
}

/**
 * Бесшовная петля из участка [start, end) (в отсчётах): длина петли — участок минус fade; начало петли — смесь
 * начала участка с его хвостом (равномощное затухание), поэтому конец петли переходит в начало без щелчка.
 */
export function seamlessLoop(channels: Float32Array[], start: number, end: number, fade: number): Float32Array[] {
    const length = end - start - fade;

    if (length <= fade || fade <= 0) {
        return channels.map((c) => c.slice(start, end));
    }

    return channels.map((c) => {
        const out = new Float32Array(length);

        for (let i = 0; i < length; i++) {
            const s = c[start + i]!;

            if (i < fade) {
                const k = i / fade;

                out[i] = s * Math.sqrt(k) + c[start + length + i]! * Math.sqrt(1 - k);
            } else {
                out[i] = s;
            }
        }

        return out;
    });
}
