import en from '../../../lang/en.json';
import ru from '../../../lang/ru.json';

/**
 * Тексты UI — только через ключи i18n (раздел 1, правило 6; раздел 12).
 * Источник ключей — lang/{ru,en}.json, те же файлы читает Laravel.
 */
export type Locale = 'ru' | 'en';
export type Dictionary = Record<string, string>;

const dictionaries: Record<Locale, Dictionary> = { ru, en };

export const fallbackLocale: Locale = 'en';

export function isLocale(value: unknown): value is Locale {
    return value === 'ru' || value === 'en';
}

/**
 * Подставляет параметры вида :name, как в Laravel.
 */
export function interpolate(
    template: string,
    params: Record<string, string | number> = {},
): string {
    return Object.entries(params)
        .sort(([a], [b]) => b.length - a.length)
        .reduce(
            (text, [name, value]) => text.replaceAll(`:${name}`, String(value)),
            template,
        );
}

export function translate(
    locale: Locale,
    key: string,
    params: Record<string, string | number> = {},
    source: Record<Locale, Dictionary> = dictionaries,
): string {
    const template = source[locale][key] ?? source[fallbackLocale][key] ?? key;

    return interpolate(template, params);
}

/** Ключи, которые есть в одном словаре и отсутствуют в другом. */
export function missingKeys(
    source: Record<Locale, Dictionary> = dictionaries,
): Record<Locale, string[]> {
    const ruKeys = new Set(Object.keys(source.ru));
    const enKeys = new Set(Object.keys(source.en));

    return {
        ru: [...enKeys].filter((key) => !ruKeys.has(key)),
        en: [...ruKeys].filter((key) => !enKeys.has(key)),
    };
}
