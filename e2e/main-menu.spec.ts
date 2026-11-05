import { expect, test } from '@playwright/test';

/**
 * Главное меню: 3D-фон с полосой Алезани (взлёты и посадки), пункты меню для гостя и пилота.
 */
test('main menu shows the runway scene and the menu', async ({ page }, testInfo) => {
    test.setTimeout(120_000);

    const errors: string[] = [];

    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto('/');
    await expect(page.getByTestId('main-menu')).toBeVisible();
    await expect(page.getByTestId('menu-login')).toBeVisible();
    await expect(page.getByTestId('menu-scene').locator('canvas')).toBeVisible({ timeout: 30_000 });

    for (const s of [6, 20, 40]) {
        await page.waitForTimeout(s === 6 ? 6000 : (s - (s === 20 ? 6 : 20)) * 1000);
        await page.screenshot({ path: testInfo.outputPath(`menu-${s}s.png`) });
    }

    await page.getByTestId('menu-login').click();
    await page.fill('#email', 'crew3@lil-critter.test');
    await page.fill('#password', 'password');
    await page.getByTestId('login-button').click();
    await page.waitForURL(/\/dashboard/);
    await page.goto('/');
    await expect(page.getByTestId('menu-quick-start')).toBeVisible();
    await page.getByTestId('menu-trainings').click();
    await expect(page.getByTestId('menu-training-tail_gunner')).toBeVisible();

    expect(errors).toEqual([]);
});
