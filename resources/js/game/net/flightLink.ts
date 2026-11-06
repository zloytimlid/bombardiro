import { echo } from '@laravel/echo-vue';
import type { WorldView } from '@/sim/view';

/**
 * Звено (этап 6): канал presence-flight.{flight}. Хост каждого экипажа 5 раз в секунду публикует положение
 * своего самолёта; все игроки звена рисуют остальные самолёты по последним данным (плавно, с экстраполяцией).
 * Физика у каждого экипажа своя — самолёты звена друг на друга не влияют.
 */
export type FlightPeer = { slot: number; name: string; p: [number, number, number]; v: [number, number, number]; q: [number, number, number, number]; phase: string; at: number };

type Channel = {
    listenForWhisper(event: string, cb: (data: unknown) => void): Channel;
    whisper(event: string, data: unknown): Channel;
};

const SEND_MS = 200;
const STALE_MS = 5000;

export class FlightLink {
    private readonly channel: Channel;
    private readonly peers = new Map<number, FlightPeer>();
    private lastSent = 0;

    constructor(
        private readonly flightUlid: string,
        private readonly slot: number,
        private readonly name: string,
    ) {
        this.channel = (echo() as unknown as { join(name: string): Channel }).join(`flight.${flightUlid}`);
        this.channel.listenForWhisper('pos', (data) => this.receive(data));
    }

    private receive(data: unknown): void {
        const d = data as Partial<FlightPeer>;

        if (typeof d.slot !== 'number' || d.slot === this.slot || !Array.isArray(d.p) || d.p.length !== 3 || !Array.isArray(d.q) || d.q.length !== 4) {
            return;
        }

        this.peers.set(d.slot, { slot: d.slot, name: String(d.name ?? ''), p: d.p, v: (Array.isArray(d.v) ? d.v : [0, 0, 0]) as FlightPeer['v'], q: d.q, phase: String(d.phase ?? ''), at: performance.now() });
    }

    /** Хост экипажа: положение своего самолёта (не чаще 5 раз в секунду). */
    publish(view: WorldView, now: number): void {
        if (now - this.lastSent < SEND_MS) {
            return;
        }

        this.lastSent = now;

        const a = view.aircraft;
        const r = (x: number): number => Math.round(x * 10) / 10;

        this.channel.whisper('pos', {
            slot: this.slot,
            name: this.name,
            p: [r(a.position.x), r(a.position.y), r(a.position.z)],
            v: [r(a.velocity.x), r(a.velocity.y), r(a.velocity.z)],
            q: [a.attitude.w, a.attitude.x, a.attitude.y, a.attitude.z].map((x) => Math.round(x * 1e4) / 1e4),
            phase: view.phase,
        });
    }

    /** Самолёты звена на момент `now`: последнее положение + скорость × возраст (не больше 1 с). */
    others(now: number): FlightPeer[] {
        const out: FlightPeer[] = [];

        for (const [slot, p] of this.peers) {
            const age = (now - p.at) / 1000;

            if (age * 1000 > STALE_MS) {
                this.peers.delete(slot);
                continue;
            }

            const k = Math.min(age, 1);

            out.push({ ...p, p: [p.p[0] + p.v[0] * k, p.p[1] + p.v[1] * k, p.p[2] + p.v[2] * k] });
        }

        return out;
    }

    dispose(): void {
        (echo() as unknown as { leave(name: string): void }).leave(`flight.${this.flightUlid}`);
    }
}
