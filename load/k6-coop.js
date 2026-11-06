/**
 * Нагрузочный прогон кооператива (раздел 14): 20 экипажей × 8 игроков, HTTP-часть протокола.
 * Хост: пульс 1 с, журнал раз в 2 с, полный снапшот мира раз в 2 с; клиенты: пульс 5 с.
 * Whisper-трафик идёт через Reverb мимо PHP и здесь не моделируется.
 *
 * Подготовка (вне продакшена):
 *   docker compose exec app php artisan load:prepare 20
 * Запуск в сети compose (nginx — адрес приложения внутри сети):
 *   docker run --rm -i --network b25j_default -v "$PWD:/w" -w /w grafana/k6 run -e BASE_URL=http://nginx load/k6-coop.js
 * Переменные: BASE_URL, DURATION (по умолчанию 2m), FIXTURE (storage/app/k6/fixture.json).
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://localhost:8000';
const fixture = JSON.parse(open(__ENV.FIXTURE || '../storage/app/k6/fixture.json'));
const rejected = new Counter('coop_rejected');

export const options = {
    scenarios: {
        coop: { executor: 'constant-vus', vus: fixture.length * 8, duration: __ENV.DURATION || '2m', gracefulStop: '10s' },
    },
    thresholds: {
        http_req_failed: ['rate<0.01'],
        'http_req_duration{kind:heartbeat}': ['p(95)<200'],
        'http_req_duration{kind:events}': ['p(95)<300'],
        'http_req_duration{kind:snapshot}': ['p(95)<400'],
    },
};

function xsrf(jar) {
    const cookies = jar.cookiesForURL(`${BASE}/`);

    return decodeURIComponent((cookies['XSRF-TOKEN'] || [''])[0]);
}

function headers(jar, kind) {
    return { headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-XSRF-TOKEN': xsrf(jar) }, tags: { kind } };
}

function login(email) {
    const jar = http.cookieJar();

    http.get(`${BASE}/login`, { tags: { kind: 'login' } });

    const res = http.post(`${BASE}/login`, JSON.stringify({ email, password: 'password' }), headers(jar, 'login'));

    check(res, { 'logged in': (r) => r.status === 200 || r.status === 204 || r.status === 302 });

    return jar;
}

// Снапшот мира ~ размера реального (WorldStateV1 «Милк-рана» — десятки КБ).
const FILLER = 'x'.repeat(30_000);

export default function () {
    const crew = fixture[Math.floor((__VU - 1) / 8) % fixture.length];
    const email = crew.members[(__VU - 1) % 8];
    const host = email === crew.host;
    const jar = login(email);
    const s = crew.session;
    let seq = 0;
    let tick = 0;
    let t = 0;

    // Итерация живёт всю длительность сценария: цикл по секундам.
    for (;;) {
        if (host || t % 5 === 0) {
            const r = http.post(`${BASE}/api/sessions/${s}/rtt`, JSON.stringify({ rtt_ms: 40 }), headers(jar, 'heartbeat'));

            if (!check(r, { 'heartbeat ok': (x) => x.status === 200 })) {
                rejected.add(1);
            }
        }

        if (host && t % 2 === 0) {
            tick += 120;

            const events = Array.from({ length: 20 }, () => ({ seq: ++seq, tick, type: 'load_probe', payload: { n: seq } }));
            const e = http.post(`${BASE}/api/sessions/${s}/events`, JSON.stringify({ v: 1, events }), headers(jar, 'events'));

            if (!check(e, { 'events ok': (x) => x.status === 200 })) {
                rejected.add(1);
            }

            const p = http.put(`${BASE}/api/sessions/${s}/snapshot`, JSON.stringify({ v: 1, tick, state: { filler: FILLER, tick } }), headers(jar, 'snapshot'));

            if (!check(p, { 'snapshot ok': (x) => x.status === 200 })) {
                rejected.add(1);
            }
        }

        t++;
        sleep(1);
    }
}
