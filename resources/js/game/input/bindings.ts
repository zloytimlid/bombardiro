/**
 * Переназначение управления (раздел 12): действие → до двух кодов. Клавиатура — KeyboardEvent.code,
 * геймпад/HOTAS — «gp:b<номер кнопки>» и «gp:a<номер оси>+|−» (ось как кнопка). Аналоговые оси —
 * отдельно (`AxisBindings`) с мёртвой зоной и кривой. Значения по умолчанию — таблица раздела 12.
 */
export const DEFAULT_BINDINGS = {
    pitch_down: ['KeyW'],
    pitch_up: ['KeyS'],
    roll_left: ['KeyA'],
    roll_right: ['KeyD'],
    yaw_left: ['KeyZ'],
    yaw_right: ['KeyX'],
    throttle_up: ['ShiftLeft', 'ShiftRight'],
    throttle_down: ['ControlLeft', 'ControlRight'],
    brakes: ['KeyB'],
    trim_up: ['BracketRight'],
    trim_down: ['BracketLeft'],
    fire_fixed: ['Space'],
    gear: ['KeyG'],
    flaps: ['KeyF'],
    checklist_next: ['KeyC'],
    scope: ['KeyT'],
    bomb_doors: ['KeyO'],
    arm: ['KeyR'],
    release: ['Space'],
    clear_jam: ['KeyR'],
    gun_fire: ['gp:b7'],
    sight_rate_up: ['ArrowUp'],
    sight_rate_down: ['ArrowDown'],
    sight_drift_left: ['ArrowLeft'],
    sight_drift_right: ['ArrowRight'],
    position_report: ['Space'],
    intercom_wheel: ['KeyQ'],
    voice_ptt: ['KeyN'],
    external_view: ['KeyV'],
    look_reset: ['KeyH'],
    pause: ['KeyP'],
    help: ['F1'],
    station_1: ['Digit1'],
    station_2: ['Digit2'],
    station_3: ['Digit3'],
    station_4: ['Digit4'],
    station_5: ['Digit5'],
    station_6: ['Digit6'],
    station_7: ['Digit7'],
    station_8: ['Digit8'],
} satisfies Record<string, string[]>;

export type BindingAction = keyof typeof DEFAULT_BINDINGS;
export type Bindings = Record<BindingAction, string[]>;

export const BINDING_ACTIONS = Object.keys(DEFAULT_BINDINGS) as BindingAction[];

/** Группы для экрана настроек. */
export const BINDING_GROUPS: { id: string; actions: BindingAction[] }[] = [
    { id: 'flight', actions: ['pitch_down', 'pitch_up', 'roll_left', 'roll_right', 'yaw_left', 'yaw_right', 'throttle_up', 'throttle_down', 'brakes', 'trim_up', 'trim_down', 'fire_fixed'] },
    { id: 'systems', actions: ['gear', 'flaps', 'checklist_next'] },
    { id: 'bombardier', actions: ['scope', 'bomb_doors', 'arm', 'release', 'sight_rate_up', 'sight_rate_down', 'sight_drift_left', 'sight_drift_right'] },
    { id: 'gunner', actions: ['gun_fire', 'clear_jam'] },
    { id: 'radio', actions: ['position_report'] },
    { id: 'common', actions: ['intercom_wheel', 'voice_ptt', 'external_view', 'look_reset', 'pause', 'help', 'station_1', 'station_2', 'station_3', 'station_4', 'station_5', 'station_6', 'station_7', 'station_8'] },
];

export type AxisName = 'pitch' | 'roll' | 'yaw' | 'throttle';
export type AxisBindings = Partial<Record<AxisName, { index: number; invert: boolean }>>;

export const DEFAULT_AXES: AxisBindings = { roll: { index: 0, invert: false }, pitch: { index: 1, invert: false } };

/** Сохранённые назначения поверх значений по умолчанию; незнакомые действия отбрасываются. */
export function resolveBindings(stored: Record<string, string[]> | null | undefined): Bindings {
    const out = { ...DEFAULT_BINDINGS } as Bindings;

    for (const action of BINDING_ACTIONS) {
        const codes = stored?.[action];

        if (Array.isArray(codes) && codes.every((c) => typeof c === 'string')) {
            out[action] = codes.slice(0, 2);
        }
    }

    return out;
}

/** Обратный индекс: код → действия (один код может значить разное на разных станциях, например Space). */
export function indexBindings(bindings: Bindings): Map<string, BindingAction[]> {
    const index = new Map<string, BindingAction[]>();

    for (const action of BINDING_ACTIONS) {
        for (const code of bindings[action]) {
            index.set(code, [...(index.get(code) ?? []), action]);
        }
    }

    return index;
}

/** Ось геймпада с мёртвой зоной и кривой чувствительности: |x| ≤ dz → 0, дальше (|x|−dz)/(1−dz) в степени curve. */
export function shapeAxis(raw: number, deadzone: number, curve: number): number {
    const a = Math.abs(raw);

    if (a <= deadzone) {
        return 0;
    }

    return Math.sign(raw) * Math.min(1, ((a - deadzone) / (1 - deadzone)) ** curve);
}

/** Подпись кода для экрана настроек: «W», «Shift», «Кнопка 3», «Ось 2+». */
export function codeLabel(code: string): string {
    const gp = /^gp:(?:b(\d+)|a(\d+)([+-]))$/.exec(code);

    if (gp) {
        return gp[1] !== undefined ? `Gamepad ${Number(gp[1]) + 1}` : `Axis ${Number(gp[2]) + 1}${gp[3]}`;
    }

    return code.replace(/^Key/, '').replace(/^Digit/, '').replace(/(Left|Right)$/, '').replace(/^Bracket/, '[ ] ').replace(/^Arrow/, '↑↓←→ ');
}
