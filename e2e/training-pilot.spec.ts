import { expect, test } from '@playwright/test';

/**
 * Этап 1: тренировка пилота грузится, симядро в воркере крутится, ИИ-пилот взлетает.
 * Пользователь crew1 создаётся DatabaseSeeder (пароль фабрики «password», только dev/CI).
 */
test('pilot training runs the sim in a worker and the AI pilot takes off', async ({ page }, testInfo) => {
    test.setTimeout(180_000);

    const errors: string[] = [];

    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto('/login');
    await page.fill('#email', 'crew1@lil-critter.test');
    await page.fill('#password', 'password');
    await page.getByTestId('login-button').click();
    await page.waitForURL(/\/dashboard/);

    await page.getByTestId('training-pilot').click();
    await page.waitForURL(/\/training\/pilot/);

    const status = page.getByTestId('flight-status');

    await expect(status).toBeVisible({ timeout: 60_000 });
    await expect(status).toHaveAttribute('data-contact', 'gear');
    await page.screenshot({ path: testInfo.outputPath('cockpit-on-runway.png') });

    await page.getByTestId('toggle-autopilot').click();

    // Разбег и отрыв: контакт сменяется на «air».
    await expect(status).toHaveAttribute('data-contact', 'air', { timeout: 120_000 });
    await page.keyboard.press('KeyV');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: testInfo.outputPath('external-after-takeoff.png') });

    expect(errors).toEqual([]);
});
