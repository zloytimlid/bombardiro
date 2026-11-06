import type { AircraftDerived, AircraftInput, AircraftState, InitialConditions } from './aircraft';
import { createAircraft, defaultInput, derive, stepAircraft } from './aircraft';
import type { WeatherConfig } from './atmosphere';
import { calmWeather } from './atmosphere';
import type { AircraftConfig } from './config';
import { Rng } from './rng';
import type { Terrain } from './terrain';

/** Фиксированный шаг симядра (раздел 1, правило 4). */
export const TICK_HZ = 60;
export const DT = 1 / TICK_HZ;

export type SimulationOptions = {
    config: AircraftConfig;
    terrain: Terrain;
    seed: number;
    initial: InitialConditions;
    weather?: WeatherConfig;
};

export type Snapshot = {
    tick: number;
    timeS: number;
    aircraft: AircraftState;
    derived: AircraftDerived;
};

/**
 * Мир вылета: один бомбардировщик (этап 1). Всё состояние детерминировано сидом и вводом.
 */
export class Simulation {
    readonly config: AircraftConfig;
    readonly terrain: Terrain;
    readonly seed: number;
    readonly weather: WeatherConfig;
    private rng: Rng;
    private aircraftState: AircraftState;
    private tickCount = 0;
    private lastInput: AircraftInput = defaultInput();

    constructor(options: SimulationOptions) {
        this.config = options.config;
        this.terrain = options.terrain;
        this.seed = options.seed >>> 0;
        this.weather = options.weather ?? calmWeather();
        this.rng = new Rng(this.seed);
        this.aircraftState = createAircraft(options.config, options.initial);
    }

    get tick(): number {
        return this.tickCount;
    }

    get timeS(): number {
        return this.tickCount * DT;
    }

    get aircraft(): AircraftState {
        return this.aircraftState;
    }

    get input(): AircraftInput {
        return this.lastInput;
    }

    derived(): AircraftDerived {
        return derive(this.config, this.aircraftState, this.terrain, this.weather);
    }

    /** Отказ двигателя (повреждение), раздел 7.3. */
    failEngine(index: 0 | 1): void {
        const failed: [boolean, boolean] = [...this.aircraftState.engineFailed];

        failed[index] = true;
        this.aircraftState = { ...this.aircraftState, engineFailed: failed };
    }

    /** Восстановление из снапшота (миграция хоста, раздел 9.3). */
    restore(state: { tick: number; rng: [number, number, number, number]; aircraft: AircraftState }): void {
        this.tickCount = state.tick;
        this.rng.setState(state.rng);
        this.aircraftState = state.aircraft;
    }

    rngState(): [number, number, number, number] {
        return this.rng.getState();
    }

    /** Прямая правка состояния — только для тестов и тренировок. */
    patchAircraft(patch: Partial<AircraftState>): void {
        this.aircraftState = { ...this.aircraftState, ...patch };
    }

    step(input: AircraftInput = this.lastInput): void {
        this.lastInput = input;
        this.aircraftState = stepAircraft(this.aircraftState, input, {
            config: this.config,
            terrain: this.terrain,
            weather: this.weather,
            rng: this.rng,
            seed: this.seed,
            timeS: this.timeS,
            dt: DT,
        });
        this.tickCount++;
    }

    run(ticks: number, input?: AircraftInput | ((sim: Simulation) => AircraftInput)): void {
        for (let i = 0; i < ticks; i++) {
            this.step(typeof input === 'function' ? input(this) : input);
        }
    }

    snapshot(): Snapshot {
        return { tick: this.tickCount, timeS: this.timeS, aircraft: this.aircraftState, derived: this.derived() };
    }

    /** Хэш полного состояния: одинаковые сид и ввод → одинаковый хэш (в одном JS-движке). */
    stateHash(): string {
        return hashState({ tick: this.tickCount, rng: this.rng.getState(), aircraft: this.aircraftState });
    }
}

/** FNV-1a (64 бита через два 32-битных) по канонической сериализации чисел. */
export function hashState(value: unknown): string {
    let h1 = 0x811c9dc5;
    let h2 = 0x01000193;
    const buffer = new DataView(new ArrayBuffer(8));

    const feedByte = (byte: number): void => {
        h1 = Math.imul(h1 ^ byte, 0x01000193);
        h2 = Math.imul(h2 ^ byte, 0x5bd1e995);
    };

    const feed = (v: unknown): void => {
        if (typeof v === 'number') {
            buffer.setFloat64(0, v);

            for (let i = 0; i < 8; i++) {
                feedByte(buffer.getUint8(i));
            }
        } else if (typeof v === 'boolean') {
            feedByte(v ? 1 : 2);
        } else if (typeof v === 'string') {
            for (let i = 0; i < v.length; i++) {
                feedByte(v.charCodeAt(i) & 0xff);
            }
        } else if (v === null || v === undefined) {
            feedByte(0);
        } else if (Array.isArray(v)) {
            feedByte(91);
            v.forEach(feed);
        } else if (typeof v === 'object') {
            for (const key of Object.keys(v as object).sort()) {
                feed(key);
                feed((v as Record<string, unknown>)[key]);
            }
        }
    };

    feed(value);

    return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}
