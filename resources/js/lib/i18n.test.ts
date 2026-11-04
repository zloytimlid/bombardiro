import { describe, expect, it } from 'vitest';
import { interpolate, isLocale, missingKeys, translate } from './i18n';

const source = {
    ru: { 'crew.seat': 'Место :seat', 'only.ru': 'только ru' },
    en: { 'crew.seat': 'Seat :seat', 'only.en': 'en only' },
};

describe('i18n', () => {
    it('interpolates Laravel-style params, longest name first', () => {
        expect(interpolate(':a :ab', { a: 1, ab: 2 })).toBe('1 2');
    });

    it('translates with fallback to English and then to the key', () => {
        expect(translate('ru', 'crew.seat', { seat: 3 }, source)).toBe('Место 3');
        expect(translate('ru', 'only.en', {}, source)).toBe('en only');
        expect(translate('en', 'unknown.key', {}, source)).toBe('unknown.key');
    });

    it('detects locales', () => {
        expect(isLocale('ru')).toBe(true);
        expect(isLocale('de')).toBe(false);
    });

    it('reports keys missing in either dictionary', () => {
        expect(missingKeys(source)).toEqual({ ru: ['only.en'], en: ['only.ru'] });
    });

    it('has no missing keys in the shipped dictionaries', () => {
        expect(missingKeys()).toEqual({ ru: [], en: [] });
    });
});
