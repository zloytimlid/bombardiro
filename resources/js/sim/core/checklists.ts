import type { AircraftState } from './aircraft';

/**
 * Чек-листы второго пилота (раздел 6.2). Пункт выполнен, когда второй пилот его отметил
 * и условие истинно. Пункт, не выполненный к концу своей фазы, — пропущенный (метрика разбора).
 */
export type ChecklistId = 'preflight' | 'start' | 'takeoff' | 'landing';

export type ChecklistItemDef = {
    id: string;
    check: (a: AircraftState, extra: { oxygenOn: boolean }) => boolean;
};

export const CHECKLISTS: Record<ChecklistId, ChecklistItemDef[]> = {
    preflight: [
        { id: 'battery', check: (a) => a.batteryOn },
        { id: 'fuel_pump', check: (a) => a.fuelPumpOn },
        { id: 'oxygen', check: (_a, x) => x.oxygenOn },
        { id: 'controls_free', check: () => true },
    ],
    start: [
        { id: 'left_engine', check: (a) => a.engines[0].mode === 'running' },
        { id: 'right_engine', check: (a) => a.engines[1].mode === 'running' },
        { id: 'hydraulics', check: (a) => a.hydraulicPressure > 0.5 },
    ],
    takeoff: [
        { id: 'flaps_takeoff', check: (a) => a.flaps > 0.1 && a.flaps < 0.5 },
        { id: 'props_max', check: (a) => a.engines.every((e) => e.rpm > 2000 || e.mode !== 'running') },
        { id: 'trim_set', check: () => true },
    ],
    landing: [
        { id: 'gear_down', check: (a) => a.gear > 0.98 },
        { id: 'flaps_down', check: (a) => a.flaps > 0.5 },
        { id: 'props_max', check: () => true },
    ],
};

/** К какой фазе вылета относится чек-лист (в конце фазы считаем пропуски). */
export const CHECKLIST_PHASE: Record<ChecklistId, string> = {
    preflight: 'preflight',
    start: 'preflight',
    takeoff: 'takeoff',
    landing: 'landing',
};

export type ChecklistState = Record<ChecklistId, Record<string, boolean>>;

export function createChecklists(): ChecklistState {
    const state = {} as ChecklistState;

    for (const id of Object.keys(CHECKLISTS) as ChecklistId[]) {
        state[id] = {};

        for (const item of CHECKLISTS[id]) {
            state[id][item.id] = false;
        }
    }

    return state;
}

/** Отметить пункт: засчитывается, только если условие выполнено. */
export function checkItem(state: ChecklistState, list: ChecklistId, item: string, a: AircraftState, extra: { oxygenOn: boolean }): boolean {
    const def = CHECKLISTS[list].find((i) => i.id === item);

    if (def === undefined || !def.check(a, extra)) {
        return false;
    }

    state[list][item] = true;

    return true;
}

export function missedItems(state: ChecklistState, list: ChecklistId): number {
    return Object.values(state[list]).filter((done) => !done).length;
}
