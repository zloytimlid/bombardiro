import type { Browser, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

/**
 * Критерии этапа 3 (раздел 9): три браузера летят одним экипажем.
 * — гонка за место: из двух одновременных запросов один получает 409;
 * — один клиент играет с отладочной задержкой сети 150 мс;
 * — закрытие вкладки хоста: новый хост продолжает вылет в пределах нескольких секунд;
 * — переподключение клиента (перезагрузка) возвращает его на то же место;
 * — у всех трёх одинаковый серверный разбор.
 * Пользователей crew1–crew3 создаёт DatabaseSeeder (пароль фабрики — «password», только dev/CI).
 */
async function loginAs(browser: Browser, email: string): Promise<Page> {
    const context = await browser.newContext({ viewport: { width: 1024, height: 600 } });
    const page = await context.newPage();

    await page.goto('/login');
    await page.fill('#email', email);
    await page.fill('#password', 'password');
    await page.getByTestId('login-button').click();
    await page.waitForURL(/\/dashboard/);

    return page;
}

/** POST/DELETE из страницы — с её cookie и XSRF-токеном. */
async function apiCall(page: Page, method: string, url: string, body?: unknown): Promise<number> {
    return page.evaluate(
        async ([m, u, b]) => {
            const token = decodeURIComponent(/(?:^|; )XSRF-TOKEN=([^;]+)/.exec(document.cookie)?.[1] ?? '');
            const res = await fetch(u as string, {
                method: m as string,
                headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-XSRF-TOKEN': token },
                body: b === undefined ? undefined : JSON.stringify(b),
            });

            return res.status;
        },
        [method, url, body] as const,
    );
}

const tickOf = async (page: Page): Promise<number> => Number(await page.getByTestId('net-status').getAttribute('data-tick'));

test('three browsers fly one sortie, survive host loss and get the same debrief', async ({ browser }, testInfo) => {
    test.setTimeout(900_000);

    const host = await loginAs(browser, 'crew1@lil-critter.test');
    const bravo = await loginAs(browser, 'crew2@lil-critter.test');
    const charlie = await loginAs(browser, 'crew3@lil-critter.test');
    const errors: string[] = [];

    for (const p of [host, bravo, charlie]) {
        p.on('pageerror', (e) => errors.push(e.message));
    }

    // Экипаж и вход по коду приглашения.
    await host.goto('/missions');
    await host.getByTestId('crew-milk-run').click();
    await expect(host.getByTestId('lobby')).toBeVisible();

    const crewUrl = host.url();
    const crew = crewUrl.split('/').pop() ?? '';
    const code = (await host.getByTestId('invite-code').textContent())?.trim() ?? '';

    for (const p of [bravo, charlie]) {
        await p.goto('/missions');
        await p.getByTestId('join-code').fill(code);
        await p.getByTestId('join').click();
        await expect(p.getByTestId('lobby')).toBeVisible();
    }

    // Гонка за одно место: ровно один успех и один 409.
    const race = await Promise.all([apiCall(bravo, 'POST', `/api/crews/${crew}/seats/navigator`), apiCall(charlie, 'POST', `/api/crews/${crew}/seats/navigator`)]);

    expect([...race].sort()).toEqual([200, 409]);

    // Победитель гонки освобождает место (у проигравшего его нет — для него это 409/403).
    const released = await Promise.all([apiCall(bravo, 'DELETE', `/api/crews/${crew}/seats/navigator`), apiCall(charlie, 'DELETE', `/api/crews/${crew}/seats/navigator`)]);

    expect(released).toContain(200);

    // Места: командир — пилот, остальные — бомбардир и хвостовой стрелок.
    await host.getByTestId('claim-pilot').click();
    await bravo.getByTestId('claim-bombardier').click();
    await charlie.getByTestId('claim-tail_gunner').click();

    for (const p of [host, bravo, charlie]) {
        await p.getByTestId('ready').click();
        await expect(p.getByTestId('ready')).toHaveText(/Готов|Ready/);
    }

    await expect(host.getByTestId('start')).toBeEnabled();
    await host.getByTestId('start').click();

    for (const p of [host, bravo, charlie]) {
        await p.waitForURL(/\/play\//);
    }

    const playUrl = host.url();

    // Три браузера с WebGL на одной машине — «низкая» графика; Charlie — с задержкой сети 150 мс в обе стороны.
    await host.goto(`${playUrl}?debug_graphics=low`);
    await bravo.goto(`${playUrl}?debug_graphics=low`);
    await charlie.goto(`${playUrl}?debug_graphics=low&debug_net_delay=150`);

    const roleOf = async (p: Page): Promise<string | null> => p.getByTestId('net-status').getAttribute('data-role');
    const pages = [host, bravo, charlie];

    // Хоста выбирает сервер (наименьший RTT) — кто именно, заранее неизвестно.
    await expect.poll(async () => (await Promise.all(pages.map(roleOf))).filter((r) => r === 'host').length, { timeout: 60_000 }).toBe(1);
    await expect.poll(async () => (await Promise.all(pages.map(roleOf))).filter((r) => r === 'client').length, { timeout: 60_000 }).toBe(2);

    const roles = await Promise.all(pages.map(roleOf));
    const hostPage = pages[roles.indexOf('host')]!;
    const clients = pages.filter((p) => p !== hostPage);

    // Клиенты видят мир хоста: тик растёт.
    for (const p of clients) {
        await expect.poll(() => tickOf(p), { timeout: 30_000 }).toBeGreaterThan(120);
    }

    await charlie.screenshot({ path: testInfo.outputPath('charlie-150ms.png') });

    // Чат доходит до экипажа.
    await clients[0]!.getByTestId('chat-input').fill('Бомболюки открыты');
    await clients[0]!.getByTestId('chat-input').press('Enter');
    await expect(hostPage.getByTestId('chat')).toContainText('Бомболюки открыты');

    // Клиент перезагружает страницу — возвращается на своё место.
    const reloaded = clients[0]!;
    const seat = reloaded === host ? 'pilot' : reloaded === bravo ? 'bombardier' : 'tail_gunner';

    await reloaded.reload();
    await expect(reloaded.getByTestId('net-status')).toHaveAttribute('data-role', 'client', { timeout: 60_000 });
    await expect(reloaded.getByTestId(`station-${seat}`)).toHaveAttribute('aria-pressed', 'true');

    // Пусть хост успеет выгрузить снапшот мира (раз в 2 с).
    await hostPage.waitForTimeout(3000);

    // Хост пропадает: страница выгружается сразу (закрытие контекста ждёт, пока вкладка доработает).
    const lost = Date.now();

    await hostPage.goto('about:blank');

    // Новый хост выбран…
    await expect.poll(async () => (await Promise.all(clients.map(roleOf))).includes('host'), { timeout: 15_000, intervals: [100] }).toBe(true);

    const newHost = (await roleOf(clients[0]!)) === 'host' ? clients[0]! : clients[1]!;
    const other = newHost === clients[0] ? clients[1]! : clients[0]!;
    const electedMs = Date.now() - lost;

    // …восстановил мир из снапшота, и мир идёт у обоих: +30 тиков (0,5 с) у хоста и у клиента.
    const t0 = await tickOf(newHost);

    await expect.poll(() => tickOf(newHost), { timeout: 15_000, intervals: [100] }).toBeGreaterThan(t0 + 30);

    const recoveredMs = Date.now() - lost;
    const tOther = await tickOf(other);

    await expect.poll(() => tickOf(other), { timeout: 15_000, intervals: [100] }).toBeGreaterThan(tOther + 30);
    await expect(other.getByTestId('host-migration')).toBeHidden({ timeout: 10_000 });

    testInfo.annotations.push({ type: 'host-migration-ms', description: `elected ${electedMs}, running ${recoveredMs}` });
    console.log(`host migration: new host elected in ${electedMs} ms, world running again in ${recoveredMs} ms`);

    // Раздел 9.3: продолжение в пределах 3 с (+0,5 с — сами 30 тиков, по которым меряем).
    // На перегруженной машине (три браузера с программным WebGL) порог можно поднять: E2E_MIGRATION_MAX_MS.
    expect(recoveredMs).toBeLessThan(Number(process.env.E2E_MIGRATION_MAX_MS ?? 3_500));

    await newHost.screenshot({ path: testInfo.outputPath('new-host.png') });

    // Отдать места ИИ и ускорить ×16 у хоста, чтобы долететь до разбора.
    for (const p of clients) {
        await p.getByTestId('toggle-autopilot').click();
    }

    await newHost.getByTestId('time-16').click();

    for (const p of clients) {
        await p.waitForURL(/\/debrief\//, { timeout: 720_000 });
        await expect(p.getByTestId('server-debrief')).toHaveAttribute('data-ready', 'true', { timeout: 120_000 });
    }

    const scores = await Promise.all(clients.map((p) => p.getByTestId('debrief').getAttribute('data-score')));

    expect(scores[0]).not.toBeNull();
    expect(scores[0]).toBe(scores[1]);

    // Разбор видит и ушедший хост.
    await hostPage.goto(clients[0]!.url());
    await expect(hostPage.getByTestId('server-debrief')).toHaveAttribute('data-ready', 'true');
    expect(await hostPage.getByTestId('debrief').getAttribute('data-score')).toBe(scores[0]);
    await clients[0]!.screenshot({ path: testInfo.outputPath('debrief.png'), fullPage: true });

    expect(errors).toEqual([]);
});
