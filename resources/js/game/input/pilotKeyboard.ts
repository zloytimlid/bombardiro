import type { AircraftInput } from '@/sim/core';
import { clamp, runningInput } from '@/sim/core';

/**
 * Ввод пилота с клавиатуры (раздел 12): W/S — тангаж, A/D — крен, Z/X — педали,
 * Shift/Ctrl — РУД, B — тормоза, G — шасси, F / Shift+F — закрылки, [ ] — триммер руля высоты.
 * Оси плавно нарастают и возвращаются в ноль, как штурвал на пружине.
 */
export type PilotKeyboardOptions = {
    /** Скорость отклонения оси при удержании, 1/с. */
    axisRate?: number;
    throttleRate?: number;
};

export class PilotKeyboard {
    private readonly pressed = new Set<string>();
    private axes = { pitch: 0, roll: 0, yaw: 0 };
    private throttle = 0;
    private gearDown = true;
    private flaps = 0;
    private readonly axisRate: number;
    private readonly throttleRate: number;
    private readonly onKeyDown = (event: KeyboardEvent): void => this.keyDown(event);
    private readonly onKeyUp = (event: KeyboardEvent): void => {
        this.pressed.delete(event.code);
    };
    private readonly onBlur = (): void => this.pressed.clear();

    constructor(
        private readonly target: Window,
        options: PilotKeyboardOptions = {},
    ) {
        this.axisRate = options.axisRate ?? 2.2;
        this.throttleRate = options.throttleRate ?? 0.45;
        target.addEventListener('keydown', this.onKeyDown);
        target.addEventListener('keyup', this.onKeyUp);
        target.addEventListener('blur', this.onBlur);
    }

    dispose(): void {
        this.target.removeEventListener('keydown', this.onKeyDown);
        this.target.removeEventListener('keyup', this.onKeyUp);
        this.target.removeEventListener('blur', this.onBlur);
    }

    /** Начальное положение органов, например на полосе с работающими двигателями. */
    reset(state: { throttle: number; gearDown: boolean; flaps: number }): void {
        this.throttle = state.throttle;
        this.gearDown = state.gearDown;
        this.flaps = state.flaps;
        this.axes = { pitch: 0, roll: 0, yaw: 0 };
    }

    get status(): { throttle: number; gearDown: boolean; flaps: number } {
        return { throttle: this.throttle, gearDown: this.gearDown, flaps: this.flaps };
    }

    private keyDown(event: KeyboardEvent): void {
        if (event.repeat) {
            this.pressed.add(event.code);

            return;
        }

        this.pressed.add(event.code);

        if (event.code === 'KeyG') {
            this.gearDown = !this.gearDown;
        } else if (event.code === 'KeyF') {
            this.flaps = clamp(Math.round((this.flaps + (event.shiftKey ? -0.25 : 0.25)) * 4) / 4, 0, 1);
        }
    }

    private axis(positive: string, negative: string, value: number, dt: number): number {
        const up = this.pressed.has(positive);
        const down = this.pressed.has(negative);

        if (up === down) {
            // Возврат к нейтрали.
            return Math.abs(value) < this.axisRate * dt * 1.5 ? 0 : value - Math.sign(value) * this.axisRate * dt * 1.5;
        }

        return clamp(value + (up ? 1 : -1) * this.axisRate * dt, -1, 1);
    }

    sample(dt: number): AircraftInput {
        this.axes.pitch = this.axis('KeyS', 'KeyW', this.axes.pitch, dt);
        this.axes.roll = this.axis('KeyD', 'KeyA', this.axes.roll, dt);
        this.axes.yaw = this.axis('KeyX', 'KeyZ', this.axes.yaw, dt);

        const throttleUp = this.pressed.has('ShiftLeft') || this.pressed.has('ShiftRight');
        const throttleDown = this.pressed.has('ControlLeft') || this.pressed.has('ControlRight');

        // Shift+F меняет закрылки — РУД в этот момент не трогаем.
        if (!this.pressed.has('KeyF')) {
            this.throttle = clamp(this.throttle + ((throttleUp ? 1 : 0) - (throttleDown ? 1 : 0)) * this.throttleRate * dt, 0, 1);
        }

        const input = runningInput(this.throttle);
        const brakes = this.pressed.has('KeyB') ? 1 : 0;

        input.pitch = this.axes.pitch;
        input.roll = this.axes.roll;
        input.yaw = this.axes.yaw;
        input.brakeLeft = brakes;
        input.brakeRight = brakes;
        input.trimPitchRate = (this.pressed.has('BracketRight') ? 1 : 0) - (this.pressed.has('BracketLeft') ? 1 : 0);
        input.gearDown = this.gearDown;
        input.flaps = this.flaps;

        return input;
    }
}
