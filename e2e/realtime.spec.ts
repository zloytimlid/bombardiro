import type { Browser, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

/**
 * Критерий этапа 0: тестовое broadcast-событие и whisper доходят до двух браузеров.
 * Каждый «браузер» — отдельный контекст со своей сессией.
 * Пользователей crew1/crew2 создаёт DatabaseSeeder (пароль фабрики — «password», только dev/CI).
 */
async function loginAs(browser: Browser, email: string): Promise<Page> {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto('/login');
    await page.fill('#email', email);
    await page.fill('#password', 'password');
    await page.getByTestId('login-button').click();
    await page.waitForURL(/\/dashboard/);

    return page;
}

test('server event and whisper reach two browsers', async ({ browser }) => {
    const alpha = await loginAs(browser, 'crew1@lil-critter.test');
    const bravo = await loginAs(browser, 'crew2@lil-critter.test');
    // Уникальный текст: в канале могут быть другие вкладки и события прошлых прогонов.
    const nonce = `check-${Date.now()}`;

    try {
        for (const page of [alpha, bravo]) {
            await page.goto('/diagnostics/realtime');
            await expect(page.getByTestId('realtime-status')).toHaveAttribute(
                'data-status',
                'connected',
            );
            await page.getByTestId('radio-message').fill(nonce);
        }

        for (const page of [alpha, bravo]) {
            const members = page.getByTestId('realtime-member');
            await expect(members.filter({ hasText: /^Crew1$/ })).toHaveCount(1);
            await expect(members.filter({ hasText: /^Crew2$/ })).toHaveCount(1);
        }

        // Серверное событие получают оба, включая отправителя.
        await alpha.getByTestId('send-broadcast').click();
        for (const page of [alpha, bravo]) {
            await expect(
                page.locator('[data-kind="broadcast"]', { hasText: `Crew1: ${nonce}` }),
            ).toHaveCount(1);
        }

        // Whisper получает второй браузер; отправителю протокол Pusher client event не возвращает.
        await bravo.getByTestId('send-whisper').click();
        await expect(
            alpha.locator('[data-kind="whisper"]', { hasText: `Crew2: ${nonce}` }),
        ).toHaveCount(1);
        await expect(bravo.locator('[data-kind="whisper"]', { hasText: nonce })).toHaveCount(0);
    } finally {
        await alpha.context().close();
        await bravo.context().close();
    }
});
