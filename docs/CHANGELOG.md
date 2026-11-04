# Changelog

Формат: [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/).

## [Unreleased]

### Added — этап 0, каркас
- Laravel 13 + официальный стартовый кит Vue (Inertia 3, Fortify: регистрация, подтверждение email, 2FA, passkeys).
- Docker Compose: nginx, php-fpm (PHP 8.4), reverb, horizon, scheduler, vite, postgres 17, redis 7, SeaweedFS (S3), mailpit.
- Reverb + Laravel Echo (`@laravel/echo-vue`), presence-канал `diagnostics`, событие `RadioCheck`,
  страница `/diagnostics/realtime`, E2E-тест «событие и whisper доходят до двух браузеров».
- Horizon, Filament 5 (`/admin`: только роль admin с подтверждённой 2FA, вход через Fortify).
- Пользователи: `locale`, `role` (player / moderator / admin, check-ограничение), `settings` JSONB.
- `pilot_profiles`: позывной (уникален без учёта регистра), звание, счётчики, предпочтительное место.
  Профиль создаётся при регистрации.
- Перечисление `Station` — 8 рабочих мест B-25J.
- i18n: `lang/{ru,en}.json`, `useI18n()`, тест на расхождение ключей.
- Пароли — argon2id; лимитер `api` 120/мин на пользователя.
- Качество: Pint, Larastan 8, ESLint (границы симядра, запрет `Math.random`), vue-tsc, Pest 4 (+ arch), Vitest, Playwright.
- CI GitHub Actions: lint → тесты (PHP 8.4 и 8.5) → E2E на docker compose; Renovate.
- Документы: ADR-0001 (авторитетный хост), ADR-0002 (vite-plus + ESLint), ADR-0003 (SeaweedFS вместо MinIO),
  допущения, todo, реестр ассетов, схема БД.
