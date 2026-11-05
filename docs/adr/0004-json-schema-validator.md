# ADR-0004: opis/json-schema для серверной валидации миссий

- Статус: принято
- Дата: 2026-11-05

## Контекст

Раздел 8 ТЗ: «сервер валидирует миссию по JSON Schema и laravel-data». Схема миссии генерируется
из zod в симядре (`resources/sim/schemas/mission.schema.json`, draft 2020-12) — одна схема на структуру
(раздел 1, правило 5). В стеке раздела 4 есть `spatie/laravel-data`, но нет валидатора JSON Schema:
laravel-data проверяет типизированный объект, а не произвольный документ по внешней схеме.

## Решение

Зависимость `opis/json-schema` (^2.6, Apache-2.0): поддерживает draft 2020-12, без расширений PHP,
активно сопровождается. Обёртка — `App\Domain\Missions\Support\MissionSchema`, импорт —
`App\Domain\Missions\Actions\ImportMission`: сначала JSON Schema (вся миссия), затем
`MissionMetaData` (laravel-data) для полей, которые читает сервер (каталог, версии, театр).

## Альтернативы

- `justinrainbow/json-schema` — нет полной поддержки draft 2020-12.
- Дублировать схему правилами Laravel/laravel-data — две схемы одной структуры, расходятся.
- Валидировать только на клиенте (zod) — нарушает раздел 8 и раздел 13 (валидация всего входа на сервере).
