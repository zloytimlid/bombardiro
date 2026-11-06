import type { HumanControls, Station, WorldAction } from '@/sim/core';
import type { InputMsg } from './schemas';
import { BUTTONS, PROTOCOL_VERSION } from './schemas';

/**
 * client-input (раздел 9.2): оси и кнопки станции — потеря допустима, важно последнее значение;
 * дискретные действия нумеруются и повторяются в каждом сообщении, пока хост не подтвердит (ack).
 */
const AXIS = 1000;
const ANGLE = 1e4;

export class InputEncoder {
    private seq = 0;
    private pending: [number, WorldAction][] = [];
    private lastSent = '';
    private lastSentAt = -Infinity;

    constructor(private readonly seat: () => Station) {}

    queue(action: WorldAction): void {
        this.pending.push([++this.seq, action]);
    }

    /** Хост подтвердил действия до номера `ack` включительно. */
    acknowledge(ack: number | undefined): void {
        if (ack !== undefined) {
            this.pending = this.pending.filter(([seq]) => seq > ack);
        }
    }

    /**
     * Сообщение для отправки или null: 30 Гц при изменениях, иначе 5 Гц.
     * `nowMs` — время кадра; `rtt` — замеренный RTT до хоста.
     */
    build(controls: HumanControls, nowMs: number, rtt: number | null): InputMsg | null {
        const fl = controls.flight;
        const msg: InputMsg = {
            v: PROTOCOL_VERSION,
            s: this.seat(),
            b: (fl?.fireFixed ? BUTTONS.fireFixed : 0) | (controls.mount?.fire ? BUTTONS.fire : 0) | (controls.mount?.clearJam ? BUTTONS.clearJam : 0),
            a: this.pending.slice(0, 32),
        };

        if (fl !== undefined) {
            msg.f = [fl.pitch ?? 0, fl.roll ?? 0, fl.yaw ?? 0, fl.brakeLeft ?? 0, fl.brakeRight ?? 0, fl.trimPitchRate ?? 0, fl.throttle?.[0] ?? 0, fl.throttle?.[1] ?? 0].map((x) =>
                Math.round(x * AXIS),
            );
        }

        if (controls.mount?.az !== undefined && controls.mount.el !== undefined) {
            msg.g = [Math.round(controls.mount.az * ANGLE), Math.round(controls.mount.el * ANGLE)];
            msg.mid = controls.mountId;
        }

        if (rtt !== null) {
            msg.r = Math.round(Math.min(rtt, 5000));
        }

        const signature = JSON.stringify([msg.s, msg.f, msg.b, msg.g, msg.a.length]);
        const changed = signature !== this.lastSent || msg.a.length > 0;
        // Небольшой допуск: при 60 FPS кадры идут через 16,7 мс — отправка каждые 2 кадра = 30 Гц.
        const interval = changed ? 1000 / 30 - 4 : 1000 / 5 - 4;

        if (nowMs - this.lastSentAt < interval) {
            return null;
        }

        this.lastSent = signature;
        this.lastSentAt = nowMs;

        return msg;
    }
}

/** Хост: ввод удалённого места → органы станции; новые действия — один раз. */
export class InputDecoder {
    private readonly applied = new Map<string, number>();

    ack(): Record<string, number> {
        return Object.fromEntries(this.applied);
    }

    decode(msg: InputMsg): { station: Station; controls: HumanControls; actions: WorldAction[]; rtt: number | null } {
        const station = msg.s as Station;
        const last = this.applied.get(station) ?? 0;
        const actions = msg.a.filter(([seq]) => seq > last).map(([, action]) => action as unknown as WorldAction);
        const maxSeq = msg.a.reduce((m, [seq]) => Math.max(m, seq), last);
        const controls: HumanControls = {};

        this.applied.set(station, maxSeq);

        if (msg.f !== undefined) {
            const f = msg.f.map((x) => x / AXIS);

            controls.flight = {
                pitch: f[0] ?? 0,
                roll: f[1] ?? 0,
                yaw: f[2] ?? 0,
                brakeLeft: f[3] ?? 0,
                brakeRight: f[4] ?? 0,
                trimPitchRate: f[5] ?? 0,
                throttle: [f[6] ?? 0, f[7] ?? 0],
                fireFixed: (msg.b & BUTTONS.fireFixed) !== 0,
            };
        }

        if (msg.g !== undefined && msg.mid !== undefined) {
            controls.mount = { az: msg.g[0] / ANGLE, el: msg.g[1] / ANGLE, fire: (msg.b & BUTTONS.fire) !== 0, clearJam: (msg.b & BUTTONS.clearJam) !== 0 };
            controls.mountId = msg.mid;
        }

        return { station, controls, actions, rtt: msg.r ?? null };
    }

    /** Игрок сменил место или вернулся: счётчик действий начинается заново. */
    reset(station: Station): void {
        this.applied.delete(station);
    }
}
