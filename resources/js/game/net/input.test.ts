import { describe, expect, it } from 'vitest';
import type { WorldView } from '@/sim/view';
import { InputDecoder, InputEncoder } from './input';
import { ViewInterpolator } from './interpolation';
import { inputSchema, parseMessage } from './schemas';

describe('client-input', () => {
    it('repeats unacknowledged actions and applies each exactly once on the host', () => {
        const enc = new InputEncoder(() => 'pilot');
        const dec = new InputDecoder();

        enc.queue({ type: 'gear', down: false });
        enc.queue({ type: 'flaps', value: 0 });

        const first = parseMessage(inputSchema, JSON.parse(JSON.stringify(enc.build({ flight: { pitch: 0.5, throttle: [0.8, 0.8] } }, 0, 120))), 'input')!;
        const a = dec.decode(first);

        expect(a.actions).toHaveLength(2);
        expect(a.controls.flight?.pitch).toBeCloseTo(0.5);
        expect(a.rtt).toBe(120);

        // Ответ хоста потерялся — клиент шлёт те же действия повторно, хост их не применяет второй раз.
        const again = enc.build({ flight: { pitch: 0.5, throttle: [0.8, 0.8] } }, 100, 120)!;

        expect(dec.decode(again).actions).toHaveLength(0);

        enc.acknowledge(dec.ack().pilot);
        expect(enc.build({ flight: { pitch: 0.5, throttle: [0.8, 0.8] } }, 400, 120)?.a).toHaveLength(0);
    });

    it('sends at 30 Hz while controls change and 5 Hz when idle', () => {
        const enc = new InputEncoder(() => 'tail_gunner');
        let sent = 0;

        for (let t = 0; t < 1000; t += 16) {
            if (enc.build({ mount: { az: t / 1000, el: 0, fire: true, clearJam: false }, mountId: 'tail' }, t, null)) {
                sent++;
            }
        }

        expect(sent).toBeGreaterThanOrEqual(25);
        expect(sent).toBeLessThanOrEqual(32);

        let idle = 0;

        for (let t = 2000; t < 3000; t += 16) {
            if (enc.build({ mount: { az: 1, el: 0, fire: false, clearJam: false }, mountId: 'tail' }, t, null)) {
                idle++;
            }
        }

        expect(idle).toBeLessThanOrEqual(6);
    });
});

describe('interpolation buffer', () => {
    const frame = (tick: number, x: number): WorldView =>
        ({
            tick,
            aircraft: { position: { x, y: 0, z: 1000 }, velocity: { x: 60, y: 0, z: 0 }, attitude: { w: 1, x: 0, y: 0, z: 0 }, gear: 0 },
            fighters: [],
            wingmen: [],
        }) as unknown as WorldView;

    it('renders 100 ms behind and extrapolates at most 250 ms', () => {
        const ip = new ViewInterpolator();

        // Снапшоты 15 Гц: каждые 4 тика, без задержки сети.
        for (let i = 0; i <= 10; i++) {
            ip.push(frame(i * 4, i * 4), (i * 4 * 1000) / 60);
        }

        const now = (40 * 1000) / 60;
        const v = ip.sample(now)!;

        // 100 мс = 6 тиков назад: x ≈ 34.
        expect(v.aircraft.position.x).toBeCloseTo(34, 0);

        const far = ip.sample(now + 2000)!;

        expect(far.aircraft.position.x).toBeLessThanOrEqual(40 + 60 * 0.25 + 1e-6);
        expect(ip.sinceLatest(now + 3000)).toBeGreaterThan(2900);
    });
});
