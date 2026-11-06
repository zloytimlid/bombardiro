import { defineConfig, devices } from '@playwright/test';

/**
 * E2E против поднятого docker compose (nginx на APP_URL).
 * Перед запуском: docker compose up -d && docker compose exec app php artisan migrate --seed
 */
export default defineConfig({
    testDir: './e2e',
    timeout: 60_000,
    expect: { timeout: 15_000 },
    fullyParallel: false,
    // Вылеты тяжёлые (WebGL, 3 браузера в кооперативе): по одному, иначе машина перегружена и замеры врут.
    workers: 1,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
    use: {
        baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8000',
        testIdAttribute: 'data-test',
        trace: 'retain-on-failure',
        locale: 'ru-RU',
    },
    projects: [
        {
            name: 'chromium',
            use: {
                ...devices['Desktop Chrome'],
                // Без флагов headless Chromium рисует WebGL на процессоре (SwiftShader): три вкладки кооператива
                // съедают CPU, и серверу не хватает ресурсов (ответы по 5–15 с, смена хоста не укладывается в срок).
                // На Windows — видеокарта через ANGLE/D3D11; на CI (Linux без GPU) — как было.
                launchOptions: process.platform === 'win32' ? { args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] } : {},
            },
        },
    ],
});
