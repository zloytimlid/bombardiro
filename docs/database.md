# Схема БД

PostgreSQL 17. Публичные идентификаторы (экипажи, вылеты) — ULID, внутренние — bigint.
Обновляется с каждой миграцией. Целевая схема — раздел 10 ТЗ; ниже — фактически созданные таблицы.

## users

Стандарт стартового кита + Fortify (2FA) + игровые поля.

| Поле | Тип | Ограничения |
|------|-----|-------------|
| id | bigint | PK |
| name, email, password | string | email уникален; пароль — argon2id |
| locale | varchar(5) | default `ru`, check `ru`/`en` |
| role | varchar(16) | default `player`, индекс, check `player`/`moderator`/`admin` (`App\Enums\UserRole`) |
| settings | jsonb | default `{}`: управление, графика, звук |
| two_factor_secret, two_factor_recovery_codes, two_factor_confirmed_at | — | Fortify |
| email_verified_at, remember_token, timestamps | — | стандарт |

`role` не входит в `$fillable`: назначается только явно (сидер, админка).

## pilot_profiles

1:1 с `users`.

| Поле | Тип | Ограничения |
|------|-----|-------------|
| id | bigint | PK |
| user_id | bigint | FK → users, unique, cascade delete |
| callsign | varchar(24) | unique; уникальный индекс по `LOWER(callsign)` |
| rank | varchar(32) | default `second_lieutenant` |
| missions_total | int | default 0 |
| flight_seconds_total | bigint | default 0 |
| preferred_seat | varchar(16) null | check по `App\Domain\Aircraft\Enums\Station` |

## theatres

| Поле | Тип | Ограничения |
|------|-----|-------------|
| slug | varchar(64) | unique (`corsica`) |
| name | jsonb | `{ru, en}` |
| origin_lat, origin_lon | decimal(9,6) | начало ENU |
| bounds | jsonb | `{min_x, max_x, min_y, max_y}`, м |
| terrain_manifest_url | string null | тайлы рельефа (пока null — процедурная заглушка) |
| definition | jsonb | параметры процедурного рельефа и полос из `resources/sim/theatres/*.json` |
| placeholder | bool | данные «по мотивам» |

## aircraft_types

| Поле | Тип | Ограничения |
|------|-----|-------------|
| slug | varchar(32) | unique (`b25j`) |
| name | string | |
| config | jsonb | содержимое `resources/sim/aircraft/b25j.json` |
| config_version | int | |

## airframes

| Поле | Тип | Ограничения |
|------|-----|-------------|
| aircraft_type_id | bigint | FK → aircraft_types, restrict |
| serial | varchar(32) | unique (`43-4064`) |
| name, livery | string | |
| state | jsonb | повреждения для кампании (этап 6) |

Контент загружается `SyncSimContent` (сидер и `php artisan sim:sync`) — источник истины в `resources/sim`.

## Служебные таблицы

`password_reset_tokens`, `sessions` (не используется: сессии в Redis), `cache`, `cache_locks`, `jobs`,
`job_batches`, `failed_jobs`, `passkeys`.

## Тестовая БД

`b25j_testing` создаётся скриптом `docker/postgres/init/01-testing-db.sql` при первом старте тома.
