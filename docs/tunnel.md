# Временная публичная ссылка через Cloudflare Tunnel

Как открыть локальный стенд (docker compose на своём ПК) в интернет по https-ссылке вида
`https://<слова>.trycloudflare.com` — без сервера, домена и аккаунтов. Подходит для демо и плейтеста.

**Ограничения.** Ссылка работает, пока включены ПК, Docker и процесс cloudflared. При каждом запуске туннеля адрес
новый. Это локальная база: всё, что сделают посетители (регистрации, экипажи, вылеты), сохраняется у вас.
Для постоянного размещения — сервер и `compose.prod.yaml` (см. [ops.md](ops.md)).

## Что нужно

- Запущенный стенд: `docker compose up -d`, сайт открывается на `http://localhost:8000`.
- Windows 10/11, PowerShell. На Linux/macOS шаги те же, меняется только бинарник cloudflared.
- В проекте уже есть всё, что нужно для работы за HTTPS-прокси (коммит `eec5792`): доверие `X-Forwarded-*`,
  ссылки от `APP_URL`, Reverb на адресе страницы, увеличенные буферы nginx. На более старом коде ссылка не заработает.

## 1. Скачать cloudflared

Официальный релиз Cloudflare с GitHub, в отдельную папку вне проекта:

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\tools\cloudflared"
```

```powershell
Invoke-WebRequest -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -OutFile "$env:USERPROFILE\tools\cloudflared\cloudflared.exe"
```

Проверить подпись — должно быть `Valid` и `CN="Cloudflare, Inc."`:

```powershell
Get-AuthenticodeSignature "$env:USERPROFILE\tools\cloudflared\cloudflared.exe" | Format-List Status, SignerCertificate
```

## 2. Собрать фронтенд и остановить Vite

В режиме разработки страницы берут скрипты с dev-сервера Vite (`localhost:5173`) — в чужом браузере этот адрес
не откроется. Нужна сборка и выключенный dev-сервер. Команды — из папки проекта.

```bash
docker compose exec vite npm run build
```

```bash
docker compose stop vite
```

Удалить файл `public/hot` (пока он есть, Laravel ссылается на Vite):

```bash
rm -f public/hot
```

## 3. Запустить туннель

Отдельным фоновым процессом — переживёт закрытие окна терминала:

```powershell
$d = "$env:USERPROFILE\tools\cloudflared"; Start-Process -FilePath "$d\cloudflared.exe" -ArgumentList 'tunnel','--no-autoupdate','--url','http://localhost:8000','--logfile',"$d\tunnel.log" -WindowStyle Hidden -PassThru
```

Запомните `Id` из вывода — это PID процесса. Адрес туннеля появится в логе через 5–15 секунд:

```powershell
Select-String -Path "$env:USERPROFILE\tools\cloudflared\tunnel.log" -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' | Select-Object -First 1
```

## 4. Переключить сайт на адрес туннеля

В `.env` проекта:

```dotenv
APP_URL=https://<адрес-из-лога>.trycloudflare.com
APP_DEBUG=false
```

- `APP_URL` с `https://` — ссылки и редиректы строятся от него, а не от адреса `localhost:8000` за туннелем.
- `APP_DEBUG=false` — посетители не увидят трассировки ошибок и содержимое окружения.

Перезапускать контейнеры не нужно: конфигурация не закеширована, `.env` читается на каждом запросе.

## 5. Проверить снаружи

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://<адрес>.trycloudflare.com/up
```

```bash
curl -sI https://<адрес>.trycloudflare.com/dashboard
```

Ожидается: `200` на `/up`; на `/dashboard` — `302` с `Location: https://<адрес>/login` (не `localhost`).
В браузере: открывается главная с 3D-сценой, вход работает, в консоли нет ошибок CSP и вебсокета.

## Выключить и вернуться к разработке

Остановить туннель (PID — из шага 3):

```powershell
Stop-Process -Id <PID>
```

Вернуть в `.env`:

```dotenv
APP_URL=http://localhost:8000
APP_DEBUG=true
```

Запустить dev-сервер Vite (он сам создаст `public/hot`):

```bash
docker compose start vite
```

## Если не работает

| Симптом | Причина и что делать |
| --- | --- |
| Страницы отдают `502`, `/up` — `200` | nginx не помещает заголовок `Link` (предзагрузка чанков сборки) в буфер FastCGI. Нужен код с `fastcgi_buffer_size 64k` в `docker/nginx/default.conf`; после правки — `docker compose exec nginx nginx -s reload`. |
| Страница без стилей, в консоли запросы к `localhost:5173` | Остался `public/hot` или Vite запущен — повторить шаг 2. |
| Редирект после входа уводит на `http://localhost:8000` | `APP_URL` в `.env` не адрес туннеля или без `https://` — шаг 4. |
| Нет лобби и кооператива, вебсокет не подключается | Контейнер `reverb` не запущен (`docker compose ps`) или старая сборка фронтенда — пересобрать (шаг 2). |
| В логе туннеля нет адреса | Нет доступа к Cloudflare (прокси, фаервол) или процесс завершился — смотреть `tunnel.log`. |
| Ссылка перестала открываться | ПК уснул, Docker остановлен или процесс cloudflared завершён. Новый запуск даёт новый адрес — обновить `APP_URL`. |

## Безопасность

- Ссылка публичная: открыть её может любой, кто её знает. Регистрация на сайте открыта.
- Панель Horizon (`/horizon`) и админка (`/admin`) пускают только администратора.
- Mailpit (`:8025`), база (`:5432`), Redis (`:6379`) и S3 (`:9000`) через туннель не видны — пробрасывается только
  `localhost:8000`.
- Не публикуйте ссылку там, где её прочтут посторонние, если в базе есть чужие данные.
