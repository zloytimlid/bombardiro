import { expect, test } from '@playwright/test';

/**
 * Этап 2: один игрок проходит «Милк-ран» от брифинга до разбора.
 * Игрок садится бомбардиром, обходит все 8 станций (1–8), затем отдаёт место ИИ
 * и включает отладочное ускорение ×16 (только вне продакшена), чтобы дойти до разбора.
 */
const STATIONS = ['pilot', 'copilot', 'bombardier', 'navigator', 'top_gunner', 'radio', 'waist_gunner', 'tail_gunner'] as const;
const PANELS: Record<(typeof STATIONS)[number], string> = {
    pilot: 'flight-status',
    copilot: 'copilot-panel',
    bombardier: 'bombardier-panel',
    navigator: 'navigator-panel',
    top_gunner: 'gunner-panel',
    radio: 'radio-panel',
    waist_gunner: 'gunner-panel',
    tail_gunner: 'gunner-panel',
};

test('a single player flies the Milk Run from briefing to debrief', async ({ page }, testInfo) => {
    test.setTimeout(600_000);

    const errors: string[] = [];

    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto('/login');
    await page.fill('#email', 'crew2@lil-critter.test');
    await page.fill('#password', 'password');
    await page.getByTestId('login-button').click();
    await page.waitForURL(/\/dashboard/);

    await page.goto('/missions/milk-run/solo?debug_time_scale=16&debug_seed=1944');

    // Брифинг: общий и ролевой, выбор станции.
    await expect(page.getByTestId('briefing')).toBeVisible();
    await expect(page.getByTestId('briefing-map')).toBeVisible();
    await page.getByTestId('briefing-station').selectOption('bombardier');
    await page.getByTestId('briefing-start').click();

    await expect(page.getByTestId('crew-bar')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('station-bombardier')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('bombardier-panel')).toBeVisible();
    await expect(page.getByTestId('phase')).toHaveAttribute('data-phase', 'preflight');

    // Переход по станциям клавишами 1–8: у каждой свой экран.
    for (const [i, station] of STATIONS.entries()) {
        await page.keyboard.press(`Digit${i + 1}`);
        await expect(page.getByTestId(`station-${station}`)).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByTestId(PANELS[station])).toBeVisible();
    }

    await page.screenshot({ path: testInfo.outputPath('tail-gunner.png') });

    // ИИ запускает двигатели и взлетает сам; ИИ занимает и место игрока.
    await page.keyboard.press('Digit1');
    await page.getByTestId('toggle-autopilot').click();
    await page.getByTestId('time-16').click();

    await expect(page.getByTestId('phase')).toHaveAttribute('data-phase', /route|formup/, { timeout: 120_000 });
    await page.screenshot({ path: testInfo.outputPath('en-route.png') });

    await expect(page.getByTestId('debrief')).toBeVisible({ timeout: 480_000 });
    await expect(page.getByTestId('debrief')).toHaveAttribute('data-outcome', 'landed');
    await expect(page.getByTestId('impact-scheme')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('debrief.png'), fullPage: true });

    expect(Number(await page.getByTestId('debrief').getAttribute('data-score'))).toBeGreaterThan(50);
    expect(errors).toEqual([]);
});
