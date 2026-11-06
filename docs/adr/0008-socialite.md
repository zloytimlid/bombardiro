# ADR-0008: Laravel Socialite для входа через Discord и Google

- Статус: принято
- Дата: 2026-11-05

## Контекст

Этап 5: «вход через Discord/Google». Fortify OAuth не умеет; нужен клиент OAuth 2 с провайдерами.

## Решение

`laravel/socialite` (^5, MIT, first-party) — Google встроен; `socialiteproviders/discord` (^4, MIT) — Discord.
Таблица `social_accounts` (provider + provider_id, уникальны), `App\Domain\Accounts\Actions\SocialLogin`:
связка по id провайдера, первый вход — к аккаунту с той же почтой или новый игрок (почта подтверждена
провайдером, позывной из ника с суффиксом при совпадении). Без ключей в `.env` провайдер выключен:
кнопок нет, маршруты отвечают 404. Заблокированный игрок не входит.

## Альтернативы

Свой OAuth-клиент — больше кода и рисков; `league/oauth2-client` — то же, что Socialite, без интеграции с Laravel.

## Последствия

Храним только id провайдера, без токенов доступа (они не нужны после входа).
