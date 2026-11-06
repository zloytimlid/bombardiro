# ADR-0007: Laravel Pulse для метрик продакшена

- Статус: принято
- Дата: 2026-11-05

## Контекст

Раздел 13 («Наблюдаемость»): Pulse — медленные запросы, очереди, соединения Reverb; клиентская телеметрия FPS и RTT
агрегированно. Pulse назван в ТЗ; пакет `laravel/pulse` (MIT, first-party) — новая зависимость.

## Решение

`laravel/pulse` (^1.8): таблицы в PostgreSQL (`create_pulse_tables`), доступ `/pulse` — шлюз `viewPulse` только для
роли admin. Регистраторы Reverb (`ReverbConnections`, `ReverbMessages`) и карточки на дашборде
(`resources/views/vendor/pulse/dashboard.blade.php`); своя карточка `App\Livewire\Pulse\ClientTelemetry`.
Телеметрия: `POST /api/telemetry` раз в 30 с (FPS по пресету, RTT в кооперативе), лимит 6/мин на игрока,
хранится только агрегатом Pulse без привязки к игроку.

## Альтернативы

Prometheus + Grafana — отдельная инфраструктура, на одном узле избыточно.

## Последствия

Pulse пишет в основную БД; при росте — отдельное подключение `PULSE_DB_CONNECTION` или Redis-ingest.
