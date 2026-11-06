#!/usr/bin/env sh
# Готовит рабочую копию при первом запуске: зависимости, .env, ключ приложения.
# Выполняется только в сервисе с APP_BOOTSTRAP=1, остальные ждут готовности vendor/.
set -e
cd /var/www/html

if [ "${APP_ENV:-}" = "production" ]; then
    # Продакшен: код и vendor/ уже в образе, переменные — из окружения контейнера (без файла .env).
    :
elif [ "${APP_BOOTSTRAP:-0}" = "1" ]; then
    if [ ! -f vendor/autoload.php ]; then
        composer install --no-interaction --prefer-dist
    fi
    if [ ! -f .env ]; then
        cp .env.example .env
    fi
    if ! grep -qE '^APP_KEY=.+' .env; then
        php artisan key:generate --force
    fi
    php artisan storage:link >/dev/null 2>&1 || true
    # Журнал могли создать artisan-команды от root (docker compose exec) — PHP-FPM пишет от www-data.
    touch storage/logs/laravel.log && chmod 666 storage/logs/laravel.log || true
else
    i=0
    until [ -f vendor/autoload.php ] && [ -f .env ]; do
        i=$((i + 1))
        if [ "$i" -gt 300 ]; then
            echo "vendor/ не появился за 5 минут" >&2
            exit 1
        fi
        sleep 1
    done
fi

# Продакшен: кэши конфигурации, маршрутов, представлений и событий (код в образе неизменен).
if [ "${APP_ENV:-}" = "production" ]; then
    php artisan optimize >/dev/null
fi

exec "$@"
