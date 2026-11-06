import * as Comlink from 'comlink';
import type { Debrief, Difficulty, HumanControls, MissionWorld, Skill, Station, TheatreConfig, TrainingSession, WorldAction, WorldStateV1 } from './core';
import { buildDebrief, createCrewAI, createTraining, DEFAULT_CONTENT, MissionWorld as World, parseAircraftConfig, parseMission } from './core';
import type { SnapMsg } from '../game/net/schemas';
import type { EncodeState } from '../game/net/snapshot';
import { createEncodeState, encodeSnap } from '../game/net/snapshot';
import type { MissionStatic, WorldView } from './view';
import { buildStatic, buildView } from './view';

/**
 * Симядро в Web Worker (раздел 4): мир вылета 60 Гц вне потока рендера.
 * Главный поток сам решает, сколько тиков продвинуть, — так шаг остаётся фиксированным.
 * В кооперативе воркер хоста принимает ввод всех мест, кодирует снапшоты и отдаёт журнал.
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
    /** Кооператив: места игроков (остальные — ИИ). По умолчанию — только своя станция. */
    humans?: Station[];
    /** Кампания: прочность зон борта 0…1. */
    initialZones?: Record<string, number>;
    /** Звено: задержка взлёта по месту в строю, с. */
    takeoffDelayS?: number;
};

export type WorkerInput = { controls: HumanControls; actions: WorldAction[] };

export type RemoteStationInput = { station: Station; controls: HumanControls; actions: WorldAction[] };

export type FinishSummary = {
    outcome: string;
    last_seq: number;
    damage_share: number;
    /** Прочность зон 0…1 (кампания: повреждения переходят в следующий вылет). */
    zones: Record<string, number>;
    crew: { station: string; health: string; bailedOut: boolean }[];
    stations: Debrief['stations'];
    track: Debrief['track'];
    duration_s: number;
};

export class SimWorker {
    private world: MissionWorld | null = null;
    private training: TrainingSession | null = null;
    private station: Station = 'pilot';
    private demo = false;
    private init_: WorkerInit | null = null;
    private enc: EncodeState = createEncodeState();

    init(init: WorkerInit): { view: WorldView; statics: MissionStatic } {
        const config = parseAircraftConfig(init.config);
        const mission = parseMission(init.mission);

        this.init_ = init;
        this.station = init.station;
        this.demo = false;
        this.enc = createEncodeState();

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
                humans: init.humans ?? [init.station],
                aiFactory: createCrewAI,
                initialZones: init.initialZones,
                takeoffDelayS: init.takeoffDelayS,
            });
        }

        return { view: this.view(), statics: buildStatic(this.world) };
    }

    /** Продвинуть мир на `ticks` шагов: действия применяются в первом тике, органы — в каждом. */
    advance(input: WorkerInput, ticks: number, remote: RemoteStationInput[] = []): WorldView {
        const world = this.required();

        for (const action of input.actions) {
            world.act(this.station, action);
        }

        for (const r of remote) {
            for (const action of r.actions) {
                world.act(r.station, action);
            }
        }

        for (let i = 0; i < ticks && world.phase !== 'debrief'; i++) {
            if (!this.demo) {
                world.applyHuman(this.station, input.controls);
            }

            for (const r of remote) {
                world.applyHuman(r.station, r.controls);
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

        if (this.init_?.humans === undefined) {
            world.setHumans(this.demo ? [] : [station]);
        }

        world.event('station_switch', { station });

        return this.view();
    }

    /** Кооператив: какие места ведут игроки (остальные — ИИ, раздел 9.3: место держит ИИ). */
    setHumans(stations: Station[]): void {
        if (this.init_) {
            this.init_ = { ...this.init_, humans: stations };
        }

        this.required().setHumans(stations);
    }

    setStationLag(station: Station, rttMs: number): void {
        this.required().setStationLag(station, rttMs);
    }

    /** ИИ на месте игрока: «смотри, как надо» в тренировке. */
    setDemo(enabled: boolean): void {
        this.demo = enabled;
        this.required().setHumans(enabled ? [] : [this.station]);
    }

    snap(key: boolean, ack: Record<string, number>): SnapMsg {
        return encodeSnap(this.required(), key, ack, this.enc);
    }

    /** События журнала после номера `after` (seq = позиция + 1). */
    eventsSince(after: number, limit: number): { seq: number; tick: number; type: string; payload: Record<string, unknown> }[] {
        return this.required()
            .events.slice(after, after + limit)
            .map((e, i) => ({ seq: after + i + 1, tick: e.tick, type: e.type, payload: e.payload }));
    }

    lastSeq(): number {
        return this.required().events.length;
    }

    recordEvent(type: string, payload: Record<string, unknown>): void {
        this.required().event(type, payload);
    }

    exportState(): WorldStateV1 {
        return this.required().exportState();
    }

    /** Новый хост: мир с того же вылета, состояние — из снапшота (раздел 9.3). */
    restore(state: unknown): WorldView {
        const world = this.required();

        world.restoreState(state as WorldStateV1);
        this.enc = createEncodeState();

        return this.view();
    }

    debrief(): Debrief {
        return buildDebrief(this.required());
    }

    /** Итог для POST /finish: сервер пересчитает цель и время по журналу. */
    finishSummary(): FinishSummary {
        const world = this.required();
        const d = buildDebrief(world);
        const zones = world.config.damage_model.value.zones;
        const damageShare = zones.reduce((s, z) => s + (1 - world.damage.zoneHp[z.id] / z.hp), 0) / zones.length;

        return {
            outcome: d.outcome,
            last_seq: world.events.length,
            damage_share: Math.min(1, Math.max(0, Math.round(damageShare * 1000) / 1000)),
            zones: Object.fromEntries(zones.map((z) => [z.id, Math.round(Math.max(0, world.damage.zoneHp[z.id] / z.hp) * 1000) / 1000])),
            crew: d.crew.map((c) => ({ station: c.station, health: c.health, bailedOut: c.bailedOut })),
            stations: d.stations,
            track: d.track,
            duration_s: d.durationS,
        };
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
