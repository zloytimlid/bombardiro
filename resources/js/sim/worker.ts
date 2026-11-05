import * as Comlink from 'comlink';
import type { Debrief, Difficulty, HumanControls, MissionWorld, Skill, Station, TheatreConfig, TrainingSession, WorldAction } from './core';
import { buildDebrief, createCrewAI, DEFAULT_CONTENT, MissionWorld as World, parseAircraftConfig, parseMission, createTraining } from './core';
import type { MissionStatic, WorldView } from './view';
import { buildStatic, buildView } from './view';

/**
 * Симядро в Web Worker (раздел 4): мир вылета 60 Гц вне потока рендера.
 * Главный поток сам решает, сколько тиков продвинуть, — так шаг остаётся фиксированным.
 * Ввод игрока — непрерывные органы его станции и очередь дискретных действий.
 */
export type WorkerInit = {
    mode: 'mission' | 'training';
    config: unknown;
    mission: unknown;
    theatre: TheatreConfig;
    difficulty: Difficulty;
    skill?: Skill;
    seed: number;
    station: Station;
};

export type WorkerInput = { controls: HumanControls; actions: WorldAction[] };

export class SimWorker {
    private world: MissionWorld | null = null;
    private training: TrainingSession | null = null;
    private station: Station = 'pilot';
    private demo = false;

    init(init: WorkerInit): { view: WorldView; statics: MissionStatic } {
        const config = parseAircraftConfig(init.config);
        const mission = parseMission(init.mission);

        this.station = init.station;
        this.demo = false;

        if (init.mode === 'training') {
            this.training = createTraining({
                station: init.station,
                config,
                content: DEFAULT_CONTENT,
                mission,
                theatre: init.theatre,
                difficulty: init.difficulty,
                skill: init.skill,
                seed: init.seed,
                humanPlays: true,
            });
            this.world = this.training.world;
        } else {
            this.training = null;
            this.world = new World({
                config,
                content: DEFAULT_CONTENT,
                mission,
                theatre: init.theatre,
                difficulty: init.difficulty,
                skill: init.skill ?? 'experienced',
                seed: init.seed,
                humans: [init.station],
                aiFactory: createCrewAI,
            });
        }

        return { view: this.view(), statics: buildStatic(this.world) };
    }

    /** Продвинуть мир на `ticks` шагов: действия применяются в первом тике, органы — в каждом. */
    advance(input: WorkerInput, ticks: number): WorldView {
        const world = this.required();

        for (const action of input.actions) {
            world.act(this.station, action);
        }

        for (let i = 0; i < ticks && world.phase !== 'debrief'; i++) {
            if (!this.demo) {
                world.applyHuman(this.station, input.controls);
            }

            if (this.training) {
                this.training.step();
            } else {
                world.step();
            }
        }

        return this.view();
    }

    /** Переход на другую станцию (одиночный режим — мгновенно, раздел 6.7). */
    setStation(station: Station): WorldView {
        const world = this.required();

        this.station = station;
        world.setHumans(this.demo ? [] : [station]);
        world.event('station_switch', { station });

        return this.view();
    }

    /** ИИ на месте игрока: «смотри, как надо» в тренировке. */
    setDemo(enabled: boolean): void {
        this.demo = enabled;
        this.required().setHumans(enabled ? [] : [this.station]);
    }

    debrief(): Debrief {
        return buildDebrief(this.required());
    }

    stateHash(): string {
        return this.required().stateHash();
    }

    private view(): WorldView {
        return buildView(this.required(), this.station, this.training?.result() ?? null);
    }

    private required(): MissionWorld {
        if (this.world === null) {
            throw new Error('World is not initialised');
        }

        return this.world;
    }
}

Comlink.expose(new SimWorker());
