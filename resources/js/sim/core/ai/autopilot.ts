import type { AircraftDerived, AircraftInput, AircraftState } from '../aircraft';
import { runningInput } from '../aircraft';
import { clamp, wrapPi } from '../math';
import { Pid } from './pid';

/** Цели автопилота. Не заданная цель — канал свободен. */
export type AutopilotTargets = {
    heading?: number;
    /** Высота, м; либо вертикальная скорость, м/с. */
    altitude?: number;
    verticalSpeed?: number;
    /** Скорость (IAS, м/с) через РУД. */
    airspeed?: number;
    /** Скорость (IAS, м/с) через тангаж — режим набора на полной мощности. */
    airspeedByPitch?: number;
    throttle?: number;
    prop?: number;
    pitch?: number;
    bank?: number;
    maxBank?: number;
    maxVerticalSpeed?: number;
    gearDown?: boolean;
    /** Предел угла атаки для защиты от сваливания, рад. */
    alphaMax?: number;
    flaps?: number;
    brakes?: number;
};

/**
 * Автопилот-«лётчик»: основа ИИ пилота (этап 2) и тестов огибающей (этап 1).
 * Работает только через AircraftInput — те же органы, что у игрока.
 */
export class Autopilot {
    private readonly pitchPid = new Pid(3.2, 1.6, 1.4, 1);
    private readonly rollPid = new Pid(2.2, 0.3, 0.9, 1);
    private readonly yawPid = new Pid(4, 2, 0, 1);
    private readonly vsPid = new Pid(0.012, 0.004, 0, 0.3);
    private readonly speedPitchPid = new Pid(0.02, 0.004, 0.04, 0.17);
    private readonly throttlePid = new Pid(0.08, 0.025, 0, 0.6);

    update(state: AircraftState, d: AircraftDerived, t: AutopilotTargets, dt: number): AircraftInput {
        const input = runningInput();
        const V = Math.max(d.indicatedAirspeed, 1);
        const onGround = state.contact === 'gear';

        // Вертикальный канал → заданный тангаж.
        let pitchCmd = t.pitch;

        if (pitchCmd === undefined && t.airspeedByPitch !== undefined) {
            const gamma = 0.05 + this.speedPitchPid.update(V - t.airspeedByPitch, dt);

            pitchCmd = d.alpha + gamma;
        } else if (pitchCmd === undefined && (t.altitude !== undefined || t.verticalSpeed !== undefined)) {
            const maxVs = t.maxVerticalSpeed ?? 8;
            const vsCmd = t.verticalSpeed ?? clamp(0.12 * ((t.altitude ?? d.altitude) - d.altitude), -maxVs, maxVs);
            const gammaCmd = Math.asin(clamp(vsCmd / Math.max(d.trueAirspeed, 1), -0.5, 0.5));

            pitchCmd = d.alpha + gammaCmd + this.vsPid.update(vsCmd - d.verticalSpeed, dt);
        }

        if (pitchCmd !== undefined) {
            // Защита от сваливания: не даём углу атаки превысить предел.
            const alphaMax = t.alphaMax ?? 0.16;

            pitchCmd = Math.min(pitchCmd, d.pitch + (alphaMax - d.alpha));
            input.pitch = this.pitchPid.update(pitchCmd - d.pitch, dt, -state.omega.y);
        }

        // Боковой канал: курс → крен → элероны; педали — против скольжения.
        let bankCmd = t.bank;

        if (bankCmd === undefined && t.heading !== undefined && !onGround) {
            const maxBank = t.maxBank ?? (25 * Math.PI) / 180;

            bankCmd = clamp(1.4 * wrapPi(t.heading - d.heading), -maxBank, maxBank);
        }

        if (onGround) {
            input.roll = this.rollPid.update(-d.roll, dt, -state.omega.x) * 0.3;

            if (t.heading !== undefined) {
                input.yaw = clamp(3 * wrapPi(t.heading - d.heading) - 1.5 * state.omega.z, -1, 1);
            }
        } else {
            input.roll = this.rollPid.update((bankCmd ?? 0) - d.roll, dt, -state.omega.x);
            input.yaw = this.yawPid.update(d.beta, dt);
        }

        // Мощность.
        if (t.throttle !== undefined) {
            input.engines.forEach((e) => (e.throttle = t.throttle ?? 0));
        } else if (t.airspeed !== undefined) {
            const thr = clamp(0.5 + this.throttlePid.update(t.airspeed - V, dt), 0, 1);

            input.engines.forEach((e) => (e.throttle = thr));
        }

        if (t.prop !== undefined) {
            input.engines.forEach((e) => (e.prop = t.prop ?? 1));
        }

        input.gearDown = t.gearDown ?? state.gear > 0.5;
        input.flaps = t.flaps ?? state.flaps;
        input.brakeLeft = t.brakes ?? 0;
        input.brakeRight = t.brakes ?? 0;

        return input;
    }

    reset(): void {
        for (const pid of [this.pitchPid, this.rollPid, this.yawPid, this.vsPid, this.speedPitchPid, this.throttlePid]) {
            pid.reset();
        }
    }
}
