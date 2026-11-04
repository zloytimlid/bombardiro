import * as Comlink from 'comlink';
import type { AircraftInput, InitialConditions, Snapshot, TheatreConfig, WeatherConfig } from './core';
import { CircuitPilot, defaultCircuit, parseAircraftConfig, ProceduralTerrain, Simulation } from './core';

/**
 * Симядро в Web Worker (раздел 4): физика 60 Гц вне потока рендера.
 * Главный поток сам решает, сколько тиков продвинуть, — так шаг остаётся фиксированным.
 */
export type WorkerInit = {
    config: unknown;
    theatre: TheatreConfig;
    seed: number;
    initial: InitialConditions;
    weather?: WeatherConfig;
};

export class SimWorker {
    private sim: Simulation | null = null;
    private autopilot: CircuitPilot | null = null;
    private theatre: TheatreConfig | null = null;

    init(init: WorkerInit): Snapshot {
        const config = parseAircraftConfig(init.config);

        this.theatre = init.theatre;
        this.sim = new Simulation({
            config,
            terrain: new ProceduralTerrain(init.theatre),
            seed: init.seed,
            initial: init.initial,
            weather: init.weather,
        });
        this.autopilot = null;

        return this.sim.snapshot();
    }

    /** Продвинуть симуляцию на `ticks` шагов с одним и тем же вводом. */
    advance(input: AircraftInput, ticks: number): Snapshot {
        const sim = this.required();

        for (let i = 0; i < ticks; i++) {
            const effective = this.autopilot ? this.autopilot.update(sim.aircraft, sim.derived(), 1 / 60) : input;

            sim.step(effective);
        }

        return sim.snapshot();
    }

    /** ИИ-пилот проходит круг (демонстрация/тренировка «смотри, как надо»). */
    setAutopilot(enabled: boolean): void {
        const runway = this.theatre?.runways[0];

        this.autopilot = enabled && runway ? new CircuitPilot(defaultCircuit(runway)) : null;
    }

    autopilotPhase(): string | null {
        return this.autopilot?.phase ?? null;
    }

    failEngine(index: 0 | 1): void {
        this.required().failEngine(index);
    }

    stateHash(): string {
        return this.required().stateHash();
    }

    private required(): Simulation {
        if (this.sim === null) {
            throw new Error('Simulation is not initialised');
        }

        return this.sim;
    }
}

Comlink.expose(new SimWorker());
