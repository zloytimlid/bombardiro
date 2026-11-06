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

## missions

| Поле | Тип | Ограничения |
|------|-----|-------------|
| slug | varchar(96) | unique(slug, version) |
| version | int | check > 0; правка опубликованной миссии = новая версия |
| title | jsonb | `{ru, en}` |
| theatre_id | bigint | FK → theatres, restrict, индекс |
| historical_date | date null | |
| difficulty | varchar(16) | check: training / normal / hard (`MissionDifficulty`) |
| definition | jsonb | миссия по разделу 8.3, валидируется по `resources/sim/schemas/mission.schema.json` |
| is_published | bool | каталог показывает последнюю опубликованную версию |
| placeholder | bool | миссия «по мотивам» |
| sources | jsonb | `[{title, url?}]` |

Миссии загружает `ImportMission` (из `sim:sync`): JSON Schema → `MissionMetaData` (laravel-data) → версия.

## crews

| Поле | Тип | Ограничения |
|------|-----|-------------|
| ulid | char(26) | unique, ключ маршрута |
| name | varchar(64) | |
| owner_id | bigint | FK → users, cascade, индекс |
| invite_code | char(8) | unique |
| visibility | varchar(16) | check: public / private |
| max_players | smallint | check 1–8 |
| status | varchar(16) | check: lobby / in_session / closed |
| mission_id | bigint | FK → missions, restrict, индекс |
| difficulty | varchar(16) | check: training / historical |
| host_user_id | bigint null | FK → users, set null; выбранный владельцем хост |

## crew_members

| Поле | Тип | Ограничения |
|------|-----|-------------|
| crew_id, user_id | bigint | FK, cascade; unique(crew_id, user_id) |
| seat | varchar(16) null | check: одна из 8 станций; частичный unique(crew_id, seat) WHERE seat IS NOT NULL |
| is_ready | bool | |
| rtt_ms | int null | последний замер |
| last_seen_at | timestamp null | пульс; место держится 120 с |
| joined_at | timestamp | |

## flight_sessions

| Поле | Тип | Ограничения |
|------|-----|-------------|
| ulid | char(26) | unique |
| crew_id | bigint | FK → crews, cascade |
| mission_id, mission_version | bigint, int | миссия и её версия на момент старта |
| seed | bigint | сид симядра |
| difficulty | varchar(16) | check |
| status | varchar(16) | check, индекс: briefing / active / finished / aborted |
| host_user_id | bigint null | текущий хост |
| started_at, ended_at | timestamp null | |
| outcome, score, verified, flags | | итог серверного разбора |
| debrief | jsonb null | итог хоста (`summary`) и серверный разбор |
| last_seq | int | последний номер журнала |

## flight_session_participants

Кто и когда сидел на месте: `flight_session_id`, `user_id` (null — ИИ), `seat`, `is_ai`, `joined_at`, `left_at`, `metrics` (jsonb, метрики станции из разбора). Check: `is_ai OR user_id IS NOT NULL`.

## flight_session_events

Журнал вылета: `flight_session_id`, `seq`, `tick`, `type`, `payload` (jsonb), `created_at` (индекс); unique(flight_session_id, seq) — повторная отправка пачки безопасна.

## achievements

| Поле | Тип | Ограничения |
|------|-----|-------------|
| slug | varchar(64) | unique |
| title, description | jsonb | `{ru, en}` |
| criteria | jsonb | декларативное условие (`AchievementRules`): `all` / `any` / `{metric, op, value}` |
| icon | varchar(32) | |
| sort | smallint | порядок в ангаре |

Каталог загружает `SyncSimContent` из `resources/sim/achievements.json` (с проверкой условий).

## user_achievements

`user_id` (FK, cascade), `achievement_id` (FK, cascade), `flight_session_id` (FK null, set null), `unlocked_at`; unique(user_id, achievement_id).

`flight_sessions.awarded_at` — вылет учтён в статистике и достижениях; индекс (status, verified, mission_id, score) — рейтинги.

## social_accounts

`user_id` (FK, cascade), `provider` (check: discord / google), `provider_id`; unique(provider, provider_id), unique(user_id, provider). Токены провайдера не хранятся.

Модерация и персональные данные (миграция `account_deletion_and_moderation`): `users.banned_at`, `users.ban_reason`;
`flight_sessions.reviewed_at`, `reviewed_by` (FK → users, set null), `review_decision` (check: accepted / rejected);
`flight_session_participants.anonymized_at` (check участника: `is_ai OR user_id IS NOT NULL OR anonymized_at IS NOT NULL`);
`crews.owner_id` — nullable, set null при удалении владельца.

## flight_session_replays (этап 6)

`flight_session_id` (FK, cascade, unique), `storage_path` (S3), `bytes`, `format_version`, `pinned`; индекс (pinned, created_at) — очистка через 30 дней.

## campaigns, campaign_progress (этап 6)

`campaigns`: `slug` (unique), `title`, `description` (jsonb `{ru, en}`), `missions` (jsonb, slug по порядку), `rules` (jsonb), `placeholder`.
`campaign_progress`: `campaign_id`, `crew_id` (FK, cascade; unique вместе), `step`, `day`, `airframe_state` (jsonb, повреждения зон), `crew_state`, `history` (jsonb), `completed_at`.
`crews.campaign_progress_id` и `flight_sessions.campaign_progress_id` — FK null, set null.

## flights (этап 6)

`ulid` (unique), `invite_code` (unique), `leader_crew_id` (FK → crews, cascade), `mission_id` (FK, restrict), `status` (check: lobby / in_session / closed), `seed`.
`crews.flight_id` (FK null, set null), `crews.flight_slot` (check 0–3; unique(flight_id, flight_slot)); то же — в `flight_sessions`.

`missions.generated_by` (FK → users null, set null) — черновик генератора: не публикуется, виден автору и его экипажам.

Таблицы Pulse (`pulse_values`, `pulse_entries`, `pulse_aggregates`) — служебные, создаются миграцией пакета.

## Служебные таблицы

`password_reset_tokens`, `sessions` (не используется: сессии в Redis), `cache`, `cache_locks`, `jobs`,
`job_batches`, `failed_jobs`, `passkeys`.

## Тестовая БД

`b25j_testing` создаётся скриптом `docker/postgres/init/01-testing-db.sql` при первом старте тома.
