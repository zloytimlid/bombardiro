# ADR-0005: spatie/laravel-typescript-transformer для типов протокола

- Статус: принято
- Дата: 2026-11-05

## Контекст

Раздел 1, правило 5: одна схема на структуру. Сообщения HTTP API кооператива (bootstrap, журнал, снапшот,
итог) описаны на сервере классами laravel-data (`App\Domain\FlightSessions\Data\Net\*`), а клиент на TypeScript
должен использовать те же поля. Ручное дублирование типов расходится при первой правке.

## Решение

Зависимость `spatie/laravel-typescript-transformer` (^3, MIT, тот же автор, что laravel-data; только dev-генерация,
в рантайме не нужна). Провайдер `App\Providers\TypeScriptTransformerServiceProvider` собирает классы с атрибутом
`#[TypeScript]` и пишет `resources/js/types/generated/net.ts` (`FlatModuleWriter`).
Команда: `php artisan typescript:transform`. Файл коммитится; ESLint и oxlint его не проверяют.

Whisper-сообщения Reverb (`input`, `snap`, `event`, `cmd`) сервер не читает — их схема одна, zod
в `resources/js/game/net/schemas.ts`.

## Альтернативы

- Ручные типы TypeScript — расходятся с сервером.
- JSON Schema из zod и валидация на сервере (как миссии, ADR-0004) — для API уже есть laravel-data,
  вторая схема нарушила бы правило 5.

## Последствия

После правки классов `Data\Net` нужно перегенерировать `net.ts`; vue-tsc ловит несовпадение в клиенте.
