# ADR-0002: сборка на vite-plus из стартового кита, ESLint как обязательный линтер

- Статус: принято
- Дата: 2026-11-04

## Контекст

Официальный стартовый кит Laravel 13 (Vue) поставляется с `vite-plus` (VoidZero): это Vite
(`@voidzero-dev/vite-plus-core`) плюс встроенные oxlint, oxfmt и Vitest, команды `vp dev/build/check`.
ТЗ (раздел 4) требует «Vite + laravel-vite-plugin», ESLint без предупреждений и Prettier.

## Решение

- Сборка и dev-сервер — `vite-plus` как в ките: это Vite с тем же `laravel-vite-plugin`, менять не на что.
- Обязательный линтер — **ESLint** (`eslint.config.js`, `npm run lint`, `--max-warnings=0`). В нём же
  границы симядра: `no-restricted-imports` (Three.js, `game/*`, сеть, UI) и запрет `Math.random`.
- Форматирование — `vp fmt` (oxfmt, совместим с Prettier по выводу) вместо отдельного Prettier,
  чтобы не держать два форматтера с разными правилами.
- Тесты — Vitest с отдельным `vitest.config.ts` (без плагинов Laravel).
- Менеджер пакетов — npm (`package-lock.json`, раздел 16); `pnpm-workspace.yaml` кита удалён.

## Альтернативы

- Убрать vite-plus и поставить «чистый» Vite — расхождение с китом, ручная поддержка обновлений.
- Только oxlint из vite-plus — нет гарантии всех правил ESLint, ТЗ называет ESLint явно.
