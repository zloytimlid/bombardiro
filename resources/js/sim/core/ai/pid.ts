import { clamp } from '../math';

/** ПИ(Д)-регулятор с ограничением интеграла (anti-windup). */
export class Pid {
    private integral = 0;
    private previous: number | null = null;

    constructor(
        private readonly kp: number,
        private readonly ki: number,
        private readonly kd: number,
        private readonly limit = 1,
    ) {}

    reset(integral = 0): void {
        this.integral = integral;
        this.previous = null;
    }

    update(error: number, dt: number, derivative?: number): number {
        const d = derivative ?? (this.previous === null ? 0 : (error - this.previous) / dt);

        this.previous = error;

        const unclamped = this.kp * error + this.ki * this.integral + this.kd * d;

        // Интегрируем, только если выход не в насыщении или ошибка его уменьшает.
        if (Math.abs(unclamped) < this.limit || Math.sign(error) !== Math.sign(this.integral)) {
            this.integral = clamp(this.integral + error * dt, -this.limit / Math.max(this.ki, 1e-9), this.limit / Math.max(this.ki, 1e-9));
        }

        return clamp(this.kp * error + this.ki * this.integral + this.kd * d, -this.limit, this.limit);
    }
}
