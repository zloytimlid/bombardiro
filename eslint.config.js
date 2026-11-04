import js from '@eslint/js';
import pluginVue from 'eslint-plugin-vue';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * ESLint — обязательный линтер по ТЗ (раздел 1, правило 6): без предупреждений.
 * Форматирование — vp fmt (см. ADR-0002).
 */
export default tseslint.config(
    {
        ignores: [
            'vendor/**',
            'node_modules/**',
            'public/**',
            'storage/**',
            'bootstrap/ssr/**',
            'resources/js/actions/**',
            'resources/js/routes/**',
            'resources/js/wayfinder/**',
            'resources/js/components/ui/**',
            'resources/js/types/generated/**',
            'playwright-report/**',
            'test-results/**',
            'coverage/**',
        ],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    ...pluginVue.configs['flat/strongly-recommended'],
    {
        files: ['**/*.vue'],
        languageOptions: {
            parserOptions: { parser: tseslint.parser },
        },
    },
    {
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: { ...globals.browser },
        },
        rules: {
            '@typescript-eslint/consistent-type-imports': [
                'error',
                { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
            ],
            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
            ],
            // Форматирование отдано vp fmt — стилистические правила Vue отключены.
            'vue/max-attributes-per-line': 'off',
            'vue/singleline-html-element-content-newline': 'off',
            'vue/multiline-html-element-content-newline': 'off',
            'vue/html-indent': 'off',
            'vue/html-self-closing': 'off',
            'vue/html-closing-bracket-newline': 'off',
            'vue/attributes-order': 'off',
            'vue/multi-word-component-names': 'off',
            'vue/require-default-prop': 'off',
            'vue/attribute-hyphenation': 'off',
            'vue/v-on-event-hyphenation': 'off',
            'vue/v-slot-style': 'off',
            'vue/no-v-html': 'error',
            'vue/no-template-shadow': 'error',
        },
    },
    {
        files: ['*.config.{js,ts}', 'e2e/**/*.ts', 'tests/**/*.ts'],
        languageOptions: { globals: { ...globals.node } },
    },
    {
        // Симядро: чистый TypeScript без DOM, Three.js, сети и game/* (раздел 1, правило 4; раздел 5).
        files: ['resources/js/sim/core/**/*.ts'],
        // Тесты ядра могут мерить время и читать файлы — ограничения только для кода ядра.
        ignores: ['resources/js/sim/core/**/*.test.ts'],
        languageOptions: { globals: {} },
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: ['three', 'three/*'],
                            message: 'Симядро не зависит от Three.js.',
                        },
                        {
                            group: ['@/game/*', '**/game/*', '**/game'],
                            message: 'Симядро не импортирует game/*.',
                        },
                        {
                            group: ['comlink', 'laravel-echo', 'pusher-js', 'axios', 'vue', '@inertiajs/*', 'howler'],
                            message: 'Симядро не знает о воркере, сети и UI.',
                        },
                    ],
                },
            ],
            'no-restricted-globals': [
                'error',
                ...['window', 'document', 'navigator', 'self', 'globalThis', 'fetch', 'XMLHttpRequest', 'WebSocket', 'requestAnimationFrame', 'performance', 'localStorage', 'setTimeout', 'setInterval', 'Date'].map(
                    (name) => ({ name, message: 'Недоступно в симядре: оно детерминировано и не знает о платформе.' }),
                ),
            ],
            'no-restricted-properties': [
                'error',
                {
                    object: 'Math',
                    property: 'random',
                    message: 'Только детерминированный ГПСЧ с сидом (раздел 7.4).',
                },
            ],
        },
    },
);
