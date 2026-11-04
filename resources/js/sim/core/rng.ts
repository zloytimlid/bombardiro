/**
 * Детерминированный ГПСЧ (sfc32) с сидом. Math.random() в ядре запрещён линтером (раздел 7.4).
 */
export class Rng {
    private a: number;
    private b: number;
    private c: number;
    private d: number;

    constructor(seed: number) {
        this.a = 0x9e3779b9;
        this.b = 0x243f6a88;
        this.c = 0xb7e15162;
        this.d = seed >>> 0;

        for (let i = 0; i < 15; i++) {
            this.nextUint32();
        }
    }

    /** Сид для подсистемы: сид миссии + номер тика + соль (раздел 7.4). */
    static derive(seed: number, tick: number, salt = 0): Rng {
        return new Rng(hash32(seed, tick, salt));
    }

    nextUint32(): number {
        const t = (((this.a + this.b) | 0) + this.d) | 0;

        this.d = (this.d + 1) | 0;
        this.a = this.b ^ (this.b >>> 9);
        this.b = (this.c + (this.c << 3)) | 0;
        this.c = (this.c << 21) | (this.c >>> 11);
        this.c = (this.c + t) | 0;

        return t >>> 0;
    }

    /** Равномерно в [0, 1). */
    next(): number {
        return this.nextUint32() / 4294967296;
    }

    range(min: number, max: number): number {
        return min + (max - min) * this.next();
    }

    /** Нормальное распределение (Бокс — Мюллер). */
    gaussian(mean = 0, sd = 1): number {
        const u = Math.max(this.next(), 1e-12);
        const v = this.next();

        return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    }

    chance(p: number): boolean {
        return this.next() < p;
    }

    /** Состояние для снапшотов и миграции хоста. */
    getState(): [number, number, number, number] {
        return [this.a, this.b, this.c, this.d];
    }

    setState([a, b, c, d]: [number, number, number, number]): void {
        this.a = a;
        this.b = b;
        this.c = c;
        this.d = d;
    }
}

/** Смешивание целых в 32-битный хэш (murmur3 finalizer). */
export function hash32(...values: number[]): number {
    let h = 0x811c9dc5;

    for (const value of values) {
        h ^= value | 0;
        h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
        h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
        h ^= h >>> 16;
    }

    return h >>> 0;
}

/** Детерминированный value noise в [-1, 1] для турбулентности и рельефа. */
export function valueNoise2(seed: number, x: number, y: number): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const corner = (i: number, j: number): number => (hash32(seed, xi + i, yi + j) / 4294967295) * 2 - 1;
    const sx = xf * xf * (3 - 2 * xf);
    const sy = yf * yf * (3 - 2 * yf);
    const top = corner(0, 0) + (corner(1, 0) - corner(0, 0)) * sx;
    const bottom = corner(0, 1) + (corner(1, 1) - corner(0, 1)) * sx;

    return top + (bottom - top) * sy;
}
