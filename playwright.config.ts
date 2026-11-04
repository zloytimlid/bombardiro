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
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
    use: {
        baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8000',
        testIdAttribute: 'data-test',
        trace: 'retain-on-failure',
        locale: 'ru-RU',
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
