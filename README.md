# Lil Critter from the Moon

Браузерный кооперативный симулятор экипажа B-25J (43-4064, 8U, 488th BS / 340th BG, Алезани, 1944).
Спецификация — PDF ТЗ (в репозиторий не входит). Готовы этапы **0 (каркас)** и **1 (симядро и полёт пилота)**.

## Стек

PHP 8.4 · Laravel 13 · Fortify (2FA, passkeys) · Inertia 3 + Vue 3.5 · Tailwind 4 · Reverb · Horizon ·
Filament 5 · PostgreSQL 17 · Redis 7 · S3 (SeaweedFS в dev, ADR-0003) · Pest 4 · Vitest · Playwright.

## Запуск с нуля

Нужен только Docker Desktop.

```bash
cp .env.example .env
docker compose up -d
docker compose exec app php artisan migrate --seed
```

Первый старт ставит Composer- и npm-зависимости внутри контейнеров (несколько минут).

| Что | Адрес |
|-----|-------|
| Приложение | http://localhost:8000 |
| Vite (HMR) | http://localhost:5173 |
| Админка Filament | http://localhost:8000/admin |
| Horizon | http://localhost:8000/horizon |
| Mailpit | http://localhost:8025 |
| S3 (SeaweedFS) | http://localhost:9000 |

Сидер создаёт администратора `admin@lil-critter.test` (пароль — `SEED_ADMIN_PASSWORD` из `.env`,
иначе сгенерированный выводится в консоль) и пилотов `crew1..3@lil-critter.test` с паролем `password`.
Вход в `/admin` — только роль admin с подтверждённой 2FA (настраивается в «Settings → Security»).

Проверка связи Reverb: `/diagnostics/realtime` в двух браузерах.

Тренировка пилота: «Кабинет → Тренировка: пилот» (`/training/pilot`). Кнопка «ИИ-пилот» показывает
взлёт, круг и посадку; `?difficulty=historical` — без дублей приборов и внешнего вида.
После правки `resources/sim/*.json`: `docker compose exec app php artisan sim:sync`,
после правки схемы конфига в `config.ts`: `npm run schemas:generate`.

## Проверки

```bash
docker compose exec app composer lint:check      # Pint
docker compose exec app composer types:check     # Larastan, уровень 8
docker compose exec app php artisan test         # Pest: Feature, Unit, Arch
npm run lint                                     # ESLint, без предупреждений
npm run types:check                              # vue-tsc --noEmit
npm run test:js                                  # Vitest
npm run test:e2e                                 # Playwright против запущенного compose
```

`vendor/` и контейнерный `node_modules/` лежат в томах Docker: bind-mount с Windows слишком медленный.
Для подсказок IDE по PHP-пакетам выполните `docker compose cp app:/var/www/html/vendor ./vendor`.

## Документы

`docs/` — допущения, ADR, схема БД, реестр ассетов, отложенное, журнал изменений.
