import type { Quat, Vec3 } from '@/sim/core/math';
import type { WorldView } from '@/sim/view';

/**
 * Интерполяция чужих объектов (раздел 9.2): буфер 100 мс; при потере снапшотов —
 * экстраполяция не дольше 250 мс. Время берётся по тикам хоста: смещение часов
 * оценивается как минимум «приход − тик/60» по последним кадрам (без влияния джиттера).
 */
export const INTERP_DELAY_MS = 100;
export const MAX_EXTRAPOLATION_MS = 250;
const TICK_MS = 1000 / 60;
const BUFFER = 40;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const lerpV = (a: Vec3, b: Vec3, t: number): Vec3 => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) });

function nlerp(a: Quat, b: Quat, t: number): Quat {
    const dot = a.w * b.w + a.x * b.x + a.y * b.y + a.z * b.z;
    const s = dot < 0 ? -1 : 1;
    const q = { w: lerp(a.w, s * b.w, t), x: lerp(a.x, s * b.x, t), y: lerp(a.y, s * b.y, t), z: lerp(a.z, s * b.z, t) };
    const n = Math.hypot(q.w, q.x, q.y, q.z) || 1;

    return { w: q.w / n, x: q.x / n, y: q.y / n, z: q.z / n };
}

export class ViewInterpolator {
    private readonly frames: WorldView[] = [];
    private offsetMs: number | null = null;
    private readonly offsets: number[] = [];

    push(view: WorldView, arrivalMs: number): void {
        const last = this.frames[this.frames.length - 1];

        if (last !== undefined && view.tick <= last.tick) {
            return;
        }

        this.frames.push(view);

        if (this.frames.length > BUFFER) {
            this.frames.shift();
        }

        this.offsets.push(arrivalMs - view.tick * TICK_MS);

        if (this.offsets.length > 30) {
            this.offsets.shift();
        }

        this.offsetMs = Math.min(...this.offsets);
    }

    get latest(): WorldView | null {
        return this.frames[this.frames.length - 1] ?? null;
    }

    /** Мс с момента последнего снапшота по часам хоста (для «нет снапшотов 3 с»). */
    sinceLatest(nowMs: number): number {
        const last = this.latest;

        return last === null || this.offsetMs === null ? Infinity : nowMs - (this.offsetMs + last.tick * TICK_MS);
    }

    reset(): void {
        this.frames.length = 0;
        this.offsets.length = 0;
        this.offsetMs = null;
    }

    /** Вид для рендера на момент now − 100 мс; UI берёт латентное состояние из latest. */
    sample(nowMs: number): WorldView | null {
        const latest = this.latest;

        if (latest === null || this.offsetMs === null) {
            return null;
        }

        const renderTick = (nowMs - INTERP_DELAY_MS - this.offsetMs) / TICK_MS;
        let i = this.frames.length - 1;

        while (i > 0 && (this.frames[i - 1]?.tick ?? 0) > renderTick) {
            i--;
        }

        const b = this.frames[i] ?? latest;
        const a = this.frames[i - 1];

        if (a === undefined || renderTick >= latest.tick) {
            // Экстраполяция по скорости не дальше 250 мс.
            const ahead = Math.min(Math.max(renderTick - latest.tick, 0) * TICK_MS, MAX_EXTRAPOLATION_MS) / 1000;

            return ahead <= 0 ? latest : this.extrapolate(latest, ahead);
        }

        const t = Math.min(Math.max((renderTick - a.tick) / Math.max(b.tick - a.tick, 1), 0), 1);
        const fightersA = new Map(a.fighters.map((f) => [f.id, f]));
        const wingA = new Map(a.wingmen.map((w) => [w.id, w]));

        return {
            ...latest,
            aircraft: {
                ...latest.aircraft,
                position: lerpV(a.aircraft.position, b.aircraft.position, t),
                attitude: nlerp(a.aircraft.attitude, b.aircraft.attitude, t),
                gear: lerp(a.aircraft.gear, b.aircraft.gear, t),
            },
            fighters: b.fighters.map((f) => {
                const fa = fightersA.get(f.id);

                return fa === undefined ? f : { ...f, position: lerpV(fa.position, f.position, t) };
            }),
            wingmen: b.wingmen.map((w) => {
                const wa = wingA.get(w.id);

                return wa === undefined ? w : { ...w, position: lerpV(wa.position, w.position, t) };
            }),
        };
    }

    private extrapolate(v: WorldView, dtS: number): WorldView {
        const move = (p: Vec3, vel: Vec3): Vec3 => ({ x: p.x + vel.x * dtS, y: p.y + vel.y * dtS, z: p.z + vel.z * dtS });

        return {
            ...v,
            aircraft: { ...v.aircraft, position: move(v.aircraft.position, v.aircraft.velocity) },
            fighters: v.fighters.map((f) => ({ ...f, position: move(f.position, f.velocity) })),
            wingmen: v.wingmen.map((w) => ({ ...w, position: move(w.position, w.velocity) })),
        };
    }
}
