import type { IntercomMessage } from '@/sim/core';

/** Единицы: приборы — исторические (mph, футы, дюймы рт. ст.), разбор и «Учебный» — на выбор (раздел 12). */
export const MS_TO_MPH = 2.236936;
export const M_TO_FT = 3.28084;
export const KG_PER_US_GAL = 2.72;

export const deg = (rad: number): number => Math.round((((rad * 180) / Math.PI) % 360 + 360) % 360);
export const signedDeg = (rad: number, digits = 1): string => ((rad * 180) / Math.PI).toFixed(digits);
export const fixed = (v: number | null | undefined, digits = 0): string => (v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(digits));

export function clockTime(seconds: number | null): string {
    if (seconds === null || !Number.isFinite(seconds)) {
        return '—';
    }

    const s = Math.max(0, Math.round(seconds));

    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** Текст фразы СПУ: параметры-идентификаторы (станция, борт, высота) тоже переводятся. */
export function intercomText(t: Translate, message: IntercomMessage): string {
    const params: Record<string, string | number> = {};

    for (const [k, v] of Object.entries(message.params)) {
        if (k === 'station' && typeof v === 'string') {
            params[k] = t(`station.${v}`);
        } else if (k === 'side' && typeof v === 'string') {
            params[k] = t(`side.${v}`);
        } else if (k === 'level' && typeof v === 'string') {
            params[k] = t(`level.${v}`);
        } else {
            params[k] = v;
        }
    }

    return t(message.key, params);
}

export function speakerName(t: Translate, from: string): string {
    return from === 'system' ? t('speaker.system') : from === 'tower' || from === 'base' ? t(`speaker.${from}`) : t(`station.${from}`);
}
