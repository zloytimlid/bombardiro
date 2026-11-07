import { createInertiaApp } from '@inertiajs/vue3';
import { initializeTheme } from '@/composables/useAppearance';
import AppLayout from '@/layouts/AppLayout.vue';
import AuthLayout from '@/layouts/AuthLayout.vue';
import SettingsLayout from '@/layouts/settings/Layout.vue';
import { initializeFlashToast } from '@/lib/flashToast';
import { initSentry } from '@/lib/sentry';
import { configureEcho } from '@laravel/echo-vue';

// Reverb — на том же хосте и порту, что и страница: nginx (и Caddy в продакшене) проксирует /app на Reverb.
// Так вебсокет работает и на localhost:8000, и за https-туннелем или доменом, без пересборки под адрес.
const secure = window.location.protocol === 'https:';
const pagePort = Number(window.location.port) || (secure ? 443 : 80);

configureEcho({
    broadcaster: 'reverb',
    wsHost: window.location.hostname,
    wsPort: pagePort,
    wssPort: pagePort,
    forceTLS: secure,
    enabledTransports: ['ws', 'wss'],
});

const appName = import.meta.env.VITE_APP_NAME || 'Laravel';

void createInertiaApp({
    title: (title) => (title ? `${title} - ${appName}` : appName),
    layout: (name) => {
        switch (true) {
            case name === 'Welcome':
            case name === 'About':
            case name.startsWith('training/'):
            case name === 'missions/Solo':
            case name.startsWith('play/'):
            case name.startsWith('debrief/'):
                return null;
            case name.startsWith('auth/'):
                return AuthLayout;
            case name.startsWith('settings/'):
                return [AppLayout, SettingsLayout];
            default:
                return AppLayout;
        }
    },
    withApp: (app) => {
        initSentry(app);
        app.directive('focus', {
            mounted: (el: HTMLElement, shouldFocus) => {
                if (shouldFocus.value !== false) {
                    el.focus();
                }
            },
        });
    },
    progress: {
        color: '#4B5563',
    },
});

// This will set light / dark mode on page load...
initializeTheme();

// This will listen for flash toast data from the server...
initializeFlashToast();
