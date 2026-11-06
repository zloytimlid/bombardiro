import type { App } from 'vue';

/**
 * Ошибки клиента в Sentry (этап 5, ADR-0006): только если задан VITE_SENTRY_DSN; без персональных данных —
 * ни IP, ни почты, ни cookie, ни тел запросов. SDK грузится отдельным чанком, только когда нужен.
 */
export function initSentry(app: App): void {
    const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;

    if (!dsn) {
        return;
    }

    void import('@sentry/vue').then((Sentry) => {
        Sentry.init({
            app,
            dsn,
            environment: import.meta.env.MODE,
            sendDefaultPii: false,
            tracesSampleRate: Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE ?? 0),
            beforeSend(event) {
                delete event.user;

                if (event.request) {
                    delete event.request.cookies;
                    delete event.request.data;
                    delete event.request.headers;
                }

                return event;
            },
        });
    });
}
