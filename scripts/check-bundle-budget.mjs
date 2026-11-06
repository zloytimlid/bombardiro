// Бюджет раздела 13: игровой JS-бандл ≤ 1,5 МБ gzip без ассетов. Считаем строго — весь JS сборки целиком.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const dir = 'public/build/assets';
const LIMIT = 1.5 * 1024 * 1024;
const files = readdirSync(dir).filter((f) => f.endsWith('.js'));
const sizes = files.map((f) => ({ f, gz: gzipSync(readFileSync(join(dir, f)), { level: 9 }).length })).sort((a, b) => b.gz - a.gz);
const total = sizes.reduce((s, x) => s + x.gz, 0);

for (const { f, gz } of sizes.slice(0, 5)) {
    console.log(`${(gz / 1024).toFixed(1).padStart(8)} KB  ${f}`);
}

console.log(`JS gzip total: ${(total / 1024 / 1024).toFixed(2)} MB (limit 1.50 MB)`);

if (total > LIMIT) {
    console.error('Bundle budget exceeded');
    process.exit(1);
}
