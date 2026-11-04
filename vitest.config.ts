import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Отдельный конфиг без плагинов Laravel/Inertia: тесты симядра и утилит идут в Node.
export default defineConfig({
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./resources/js', import.meta.url)),
        },
    },
    test: {
        environment: 'node',
        include: ['resources/js/**/*.test.ts', 'tests/js/**/*.test.ts'],
        coverage: {
            provider: 'v8',
            include: ['resources/js/sim/core/**/*.ts'],
            exclude: ['**/*.test.ts'],
            thresholds: {
                lines: 80,
                functions: 80,
                branches: 80,
                statements: 80,
            },
        },
    },
});
