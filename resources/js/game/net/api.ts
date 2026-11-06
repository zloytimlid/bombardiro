/**
 * JSON API на том же домене (раздел 11): сессионная аутентификация и защита от подделки
 * запросов через cookie XSRF-TOKEN, как у Inertia/axios.
 */
export class ApiError extends Error {
    constructor(
        readonly status: number,
        message: string,
        readonly body: unknown,
    ) {
        super(message);
    }
}

function xsrfToken(): string | null {
    const match = document.cookie.match(/(?:^|; )XSRF-TOKEN=([^;]+)/);

    return match ? decodeURIComponent(match[1] ?? '') : null;
}

export async function api<T = unknown>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
    const token = xsrfToken();

    if (token !== null) {
        headers['X-XSRF-TOKEN'] = token;
    }

    if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url, { method, headers, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    const data: unknown = text === '' ? null : JSON.parse(text);

    if (!response.ok) {
        const message = typeof data === 'object' && data !== null && 'message' in data ? String((data as { message: unknown }).message) : response.statusText;

        throw new ApiError(response.status, message, data);
    }

    return data as T;
}

/** RTT запроса до сервера (для выбора хоста, раздел 9.1). */
export async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; rttMs: number }> {
    const t0 = performance.now();
    const result = await fn();

    return { result, rttMs: Math.round(performance.now() - t0) };
}
