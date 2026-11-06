/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import en from '../../lang/en.json';
import ru from '../../lang/ru.json';

/**
 * Критерий этапа 4: нет строк без перевода (автопроверка ключей).
 * Ключи берутся из вызовов t('…') / t(`префикс.${…}`) во фронтенде и __('…') на сервере.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKIP = new Set(['node_modules', 'vendor', 'actions', 'routes', 'wayfinder', 'generated', 'ui']);

function files(dir: string, ext: RegExp): string[] {
    const out: string[] = [];

    for (const name of readdirSync(dir)) {
        const path = join(dir, name);

        if (statSync(path).isDirectory()) {
            if (!SKIP.has(name)) {
                out.push(...files(path, ext));
            }
        } else if (ext.test(name) && !name.endsWith('.test.ts')) {
            out.push(path);
        }
    }

    return out;
}

const front = files(join(ROOT, 'resources', 'js'), /\.(vue|ts)$/);
const back = files(join(ROOT, 'app'), /\.php$/);
// Группы PHP-переводов (lang/ru/validation.php …): верхний уровень ключей — «группа.ключ».
const phpGroupKeys = (group: string): string[] => {
    try {
        const src = readFileSync(join(ROOT, 'lang', 'ru', `${group}.php`), 'utf8');

        return [...src.matchAll(/^ {4}'([a-z_]+)' =>/gm)].map((m) => `${group}.${m[1]!}`);
    } catch {
        return [];
    }
};
const ruKeys = new Set([...Object.keys(ru), ...phpGroupKeys('validation')]);
// Английские тексты PHP-групп — встроенные в Laravel (fallback_locale = en).
const enKeys = new Set([...Object.keys(en), ...phpGroupKeys('validation')]);

type Use = { key: string; file: string; prefix: boolean };

function uses(): Use[] {
    const out: Use[] = [];

    for (const file of front) {
        const src = readFileSync(file, 'utf8');

        for (const m of src.matchAll(/\bt\(\s*'([a-z0-9_]+(?:\.[a-z0-9_]+)+)'/g)) {
            out.push({ key: m[1]!, file, prefix: false });
        }

        for (const m of src.matchAll(/\bt\(\s*`([a-z0-9_.]+)\.\$\{/g)) {
            out.push({ key: `${m[1]!}.`, file, prefix: true });
        }
    }

    for (const file of back) {
        const src = readFileSync(file, 'utf8');

        for (const m of src.matchAll(/__\(\s*'([a-z0-9_]+(?:\.[a-z0-9_]+)+)'/g)) {
            out.push({ key: m[1]!, file, prefix: false });
        }
    }

    return out;
}

describe('translations', () => {
    it('ru and en have exactly the same keys and no empty values', () => {
        expect(Object.keys(ru).filter((k) => !(k in en))).toEqual([]);
        expect(Object.keys(en).filter((k) => !(k in ru))).toEqual([]);
        expect(Object.entries({ ...ru, ...en }).filter(([, v]) => typeof v !== 'string' || v.trim() === '')).toEqual([]);
    });

    it('every key used in code exists in both locales', () => {
        const all = uses();
        const missing = all
            .filter((u) => (u.prefix ? ![...ruKeys].some((k) => k.startsWith(u.key)) : !ruKeys.has(u.key) || !enKeys.has(u.key)))
            .map((u) => `${u.key} (${relative(ROOT, u.file)})`);

        expect(all.length).toBeGreaterThan(200);
        expect([...new Set(missing)]).toEqual([]);
    });

    it('server strings use dotted keys, not English sentences', () => {
        const sentences = back.flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/__\(\s*'([^']*[ A-Z][^']*)'/g)].map((m) => `${m[1]!} (${relative(ROOT, file)})`));

        expect(sentences).toEqual([]);
    });

    it('templates carry no hard-coded English text either (units of the historical instruments excepted)', () => {
        // Единицы и сокращения исторических приборов и данных борта — не переводятся.
        const units = /\b(?:mph|kt|ms|MHz|MP|TOT|ETA|CHT|Space|rpm|gal|ft|min|PDI|GS|FPS|BS|B-25J|\d+th|\d+U)\b/g;
        const offenders: string[] = [];

        for (const file of front.filter((f) => f.endsWith('.vue') && !f.includes(`${'components'}/ui/`))) {
            const src = readFileSync(file, 'utf8');
            const template = /<template>([\s\S]*)<\/template>/.exec(src)?.[1] ?? '';
            const stripped = template.replace(/<!--[\s\S]*?-->/g, '').replace(/\{\{[\s\S]*?\}\}/g, ' ');
            const texts = [...stripped.matchAll(/>\s*([^<>]*?[A-Za-z]{2,}[^<>]*?)\s*</g)].map((m) => m[1]!.trim());
            const attrs = [...stripped.matchAll(/\s(?:title|label|placeholder|aria-label|alt)="([^"]*[A-Za-z]{2,}[^"]*)"/g)].map((m) => m[1]!);

            for (const text of [...texts, ...attrs]) {
                if (/[A-Za-z]{2,}/.test(text.replace(units, ''))) {
                    offenders.push(`${relative(ROOT, file)}: ${text}`);
                }
            }
        }

        expect(offenders).toEqual([]);
    });

    it('templates carry no hard-coded Russian text', () => {
        const offenders: string[] = [];

        for (const file of front.filter((f) => f.endsWith('.vue'))) {
            const src = readFileSync(file, 'utf8');
            const template = /<template>([\s\S]*)<\/template>/.exec(src)?.[1] ?? '';
            const stripped = template.replace(/<!--[\s\S]*?-->/g, '').replace(/\{\{[\s\S]*?\}\}/g, '').replace(/"[^"]*"/g, '""');

            if (/[А-Яа-яЁё]/.test(stripped)) {
                offenders.push(relative(ROOT, file));
            }
        }

        expect(offenders).toEqual([]);
    });
});
