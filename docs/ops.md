# Эксплуатация: деплой, резервные копии, восстановление

Ранбук продакшена (этап 5, раздел 13). Один узел: Caddy (TLS) → nginx (статика, PHP-FPM, WebSocket) → app / reverb;
Horizon и планировщик — отдельные контейнеры; PostgreSQL 17, Redis 7 (AOF). Описание — `compose.prod.yaml`.

## Требования к серверу

- 4 vCPU, 8 ГБ ОЗУ, SSD 40 ГБ; Docker 27+ с compose v2; открыты 80/443.
- DNS: `APP_DOMAIN` указывает на сервер (Caddy сам получает сертификат Let's Encrypt).
- S3-совместимое хранилище: бакет ассетов/повторов (`AWS_*`) и отдельный бакет резервных копий (`BACKUP_*`)
  с правилом жизненного цикла «удалять объекты `db/` старше 14 дней».

## Переменные окружения (.env на сервере, в репозиторий не попадает)

Обязательные сверх `.env.example`: `APP_KEY`, `APP_URL=https://<домен>`, `APP_DOMAIN`, `APP_VERSION` (тег образа),
`DB_*`, `REDIS_PASSWORD`, `REVERB_APP_ID/KEY/SECRET`, `VITE_REVERB_HOST=<домен>`, `VITE_REVERB_PORT=443`,
`VITE_REVERB_SCHEME=https`, `SESSION_SECURE_COOKIE=true`, `MAIL_*`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` (только на
первый сид), `BACKUP_BUCKET`, `BACKUP_AWS_*`. Мониторинг: `SENTRY_LARAVEL_DSN`, `VITE_SENTRY_DSN`,
`SENTRY_TRACES_SAMPLE_RATE` (0.05), `PULSE_ENABLED=true`. Вход через Discord/Google: `DISCORD_CLIENT_ID/SECRET`,
`GOOGLE_CLIENT_ID/SECRET` (пустые — кнопки скрыты). `ADMIN_REQUIRE_2FA=true` (не отключать в продакшене).

## Первый запуск

```sh
git clone <repo> /opt/b25j && cd /opt/b25j
cp .env.example .env   # заполнить по списку выше
docker compose -f compose.prod.yaml build
docker compose -f compose.prod.yaml up -d postgres redis
docker compose -f compose.prod.yaml run --rm app php artisan migrate --force --seed
docker compose -f compose.prod.yaml up -d
```

Проверка: `https://<домен>/up` отвечает 200; `/admin` — только админ с подтверждённой 2FA; `/pulse` и `/horizon` — только админ.

## Деплой новой версии

1. `git pull` на сервере (тег релиза), `APP_VERSION=<тег>` в `.env`.
2. `docker compose -f compose.prod.yaml build app web` — образы собираются целиком (зависимости, ассеты, opcache без
   проверки файлов).
3. Миграции до переключения: `docker compose -f compose.prod.yaml run --rm app php artisan migrate --force`
   (миграции только «расширяющие»: новый код совместим со старой схемой и наоборот на время выката).
4. `docker compose -f compose.prod.yaml run --rm app php artisan sim:sync` — контент симуляции (новая версия
   опубликованной миссии создаётся автоматически; идущие вылеты держат свою версию).
5. `docker compose -f compose.prod.yaml up -d` — пересоздаются app, reverb, horizon, scheduler, web.
6. Кэши: `php artisan optimize` выполняется в контейнере при старте (`config:cache`, `route:cache`, `view:cache`, `event:cache`).
7. После выката: `php artisan horizon:terminate` (воркеры перезапустятся с новым кодом), проверить `/up`, Pulse, Sentry.

Идущие вылеты при перезапуске Reverb теряют WebSocket на несколько секунд: клиенты переподключаются, хост
продолжает (место держится 120 с). Выкатывать вне пиковых часов; объявление — баннером за 15 минут.

### Откат

`APP_VERSION=<предыдущий тег>`, `docker compose -f compose.prod.yaml up -d`. Миграции не откатываются (расширяющие);
если нужна обратная миграция — только после резервной копии и по отдельному решению.

## Резервные копии (раздел 13: ежедневно, хранение 14 дней)

- Сервис `backup` (cron в контейнере): `docker/backup/backup.sh` в 03:30 UTC — `pg_dump` | gzip → `s3://$BACKUP_BUCKET/db/`.
  Срок хранения — правило жизненного цикла бакета (14 дней); локально — 2 дня в томе `backups`.
- Redis — только кэш, очереди и снапшоты миграции хоста (TTL 10 мин): в копию не входит, AOF — для перезапуска.
- S3 ассетов и повторов — версионирование бакета включено, повторы хранятся 30 дней (кроме закреплённых).
- Ручная копия перед рискованной операцией: `docker compose -f compose.prod.yaml exec backup /scripts/backup.sh`.

## Проверка восстановления (раз в месяц)

Автоматически 1-го числа в 05:00 UTC: `docker/backup/restore-check.sh` — последний дамп из S3 во временную БД
`b25j_restore_check`, проверочные запросы (пользователи > 0, опубликованных миссий ≥ 3), удаление временной БД.
Результат — в журнале контейнера `backup`; падение проверки — алерт (см. ниже). Вручную:
`docker compose -f compose.prod.yaml exec backup /scripts/restore-check.sh`.

## Восстановление после аварии

1. Остановить приём трафика: `docker compose -f compose.prod.yaml stop caddy`.
2. Скачать дамп: `aws s3 cp s3://$BACKUP_BUCKET/db/<файл> .` (или последний — `aws s3 ls … | tail -n 1`).
3. Пересоздать БД: `docker compose -f compose.prod.yaml exec postgres psql -U $DB_USERNAME -d postgres -c 'DROP DATABASE b25j' -c 'CREATE DATABASE b25j'`.
4. Залить: `gunzip -c <файл> | docker compose -f compose.prod.yaml exec -T postgres psql -U $DB_USERNAME -d b25j`.
5. `php artisan migrate --force` (если дамп старше последней миграции), `php artisan sim:sync`, `php artisan optimize`.
6. Запустить: `docker compose -f compose.prod.yaml up -d`; проверить `/up`, вход, лобби, разбор последнего вылета.

Потеря данных — не больше суток (RPO 24 ч), время восстановления — около 30 минут (RTO).

## Наблюдаемость и алерты

- Журналы: `LOG_CHANNEL=json` — структурные JSON-строки в stderr контейнеров, у запросов вылета — `flight_session_id`.
  Смотреть: `docker compose -f compose.prod.yaml logs -f app reverb horizon`.
- Pulse (`/pulse`, только админ): медленные запросы и задачи, очереди, исключения, соединения и сообщения Reverb,
  клиентская телеметрия FPS и RTT (агрегированно).
- Sentry: ошибки сервера и клиента без персональных данных (`send_default_pii=false`, адреса и тела запросов вырезаются).
- Алерты: Sentry — новые ошибки и рост частоты; внешний мониторинг `/up` и WebSocket (`/app`) раз в минуту;
  падение `restore-check` и `backup` — по журналу контейнера (правило в системе мониторинга хостинга).

## Чек-лист безопасности (раздел 13: OWASP ASVS 1)

| Требование | Где сделано | Проверка |
|---|---|---|
| Пароли argon2id | `HASH_DRIVER=argon2id` | `tests/Feature/SecurityTest.php` |
| Защита от подделки запросов | группа `web` (сессия + XSRF), API — тот же домен | Pest: запрос без токена → 419 |
| Валидация всего входа | FormRequest / laravel-data (`Data\Net\*`, `UserSettingsData`), JSON Schema миссий | Pest |
| Авторизация каналов | `ChannelAuth` (экипаж, вылет, место) | Pest |
| CSP и строгие заголовки | `SecurityHeaders` (nonce для встроенного скрипта, только свой домен), HSTS в продакшене | Pest |
| Админка только для admin с 2FA | `User::canAccessPanel`, `ADMIN_REQUIRE_2FA` | Pest |
| Ограничение частоты | `RateLimiter` (api 120/мин, события, снапшоты, пульс) | Pest |
| Блокировка игроков | модерация в `/admin`, `EnsureNotBanned` | Pest |
| Минимум персональных данных | email, позывной; выгрузка `GET /api/me/export`, удаление с обезличиванием | Pest |
| Sentry без PII | `config/sentry.php`: `send_default_pii=false`, очистка запросов | ревью конфигурации |
| Аудит зависимостей | `composer audit && npm audit` в CI | CI |
| Секреты не в репозитории | `.env` вне git, `.dockerignore` | ревью |

## Закрытая бета

Критерий этапа 5 — ≥ 10 экипажей без критических ошибок в Sentry за 7 дней — проверяется на развёрнутом стенде
после выката; отчёт — в `docs/todo.md`.
