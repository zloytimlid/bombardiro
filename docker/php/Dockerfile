# syntax=docker/dockerfile:1
FROM php:8.4-fpm-bookworm AS base

ADD --chmod=0755 https://github.com/mlocati/docker-php-extension-installer/releases/latest/download/install-php-extensions /usr/local/bin/

RUN apt-get update \
    && apt-get install -y --no-install-recommends git unzip postgresql-client \
    && rm -rf /var/lib/apt/lists/* \
    && install-php-extensions pdo_pgsql pgsql redis intl zip pcntl bcmath gd exif opcache sockets

COPY --from=composer:2 /usr/bin/composer /usr/local/bin/composer

# Node нужен в том же образе: плагин Wayfinder для Vite вызывает php artisan.
COPY --from=node:24-bookworm-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=node:24-bookworm-slim /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

COPY docker/php/php.ini /usr/local/etc/php/conf.d/zz-app.ini
COPY --chmod=0755 docker/php/entrypoint.sh /usr/local/bin/app-entrypoint

ARG UID=1000
ARG GID=1000
RUN groupmod -o -g ${GID} www-data && usermod -o -u ${UID} -g ${GID} www-data

WORKDIR /var/www/html
ENTRYPOINT ["app-entrypoint"]
CMD ["php-fpm"]
