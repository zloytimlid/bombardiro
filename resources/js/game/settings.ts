import type { UserSettingsData } from '@/types/generated/net';
import type { Volumes } from './audio/sound';
import { DEFAULT_VOLUMES, loadVolumes } from './audio/sound';
import type { AxisBindings, AxisName } from './input/bindings';
import { DEFAULT_AXES, resolveBindings } from './input/bindings';
import type { InputPrefs } from './input/stationInput';

/**
 * Настройки игрока в игре (раздел 12): одна схема — UserSettingsData (laravel-data → TS), значения
 * по умолчанию — те же, что на сервере. Гость (тренировка без входа) получает значения по умолчанию.
 */
export const DEFAULT_SETTINGS: UserSettingsData = {
    bindings: {},
    mouse_sensitivity: 1,
    invert_y: false,
    gamepad_axes: {},
    gamepad_deadzone: 0.08,
    gamepad_curve: 1.6,
    graphics: 'medium',
    render_scale: 1,
    shadows: true,
    volumes: {},
    subtitles: true,
    camera_shake: true,
    ui_scale: 100,
    long_actions: 'hold',
    units: 'imperial',
    renderer: 'webgl',
};

export function withDefaults(settings: Partial<UserSettingsData> | null | undefined): UserSettingsData {
    return { ...DEFAULT_SETTINGS, ...(settings ?? {}) };
}

export function inputPrefsFrom(settings: UserSettingsData): InputPrefs {
    const stored = settings.gamepad_axes ?? {};
    const axes: AxisBindings = Object.keys(stored).length > 0 ? {} : { ...DEFAULT_AXES };

    for (const name of ['pitch', 'roll', 'yaw', 'throttle'] as AxisName[]) {
        const a = stored[name];

        if (a && Number.isInteger(a.index) && a.index >= 0) {
            axes[name] = { index: a.index, invert: Boolean(a.invert) };
        }
    }

    return {
        bindings: resolveBindings(settings.bindings),
        axes,
        deadzone: settings.gamepad_deadzone,
        curve: settings.gamepad_curve,
        mouseSensitivity: settings.mouse_sensitivity,
        invertY: settings.invert_y,
        longActions: settings.long_actions === 'toggle' ? 'toggle' : 'hold',
    };
}

/** Громкость: с сервера, иначе — сохранённая в браузере (гость), иначе — по умолчанию. */
export function volumesFrom(settings: UserSettingsData): Volumes {
    const v = settings.volumes ?? {};

    if (Object.keys(v).length === 0) {
        return loadVolumes();
    }

    return { ...DEFAULT_VOLUMES, ...Object.fromEntries(Object.entries(v).filter(([k, x]) => k in DEFAULT_VOLUMES && typeof x === 'number' && x >= 0 && x <= 1)) };
}

/** Масштаб интерфейса 80–150 % (раздел 12, доступность): от размера шрифта корня — Tailwind в rem. */
export function applyUiScale(settings: UserSettingsData, root: HTMLElement = document.documentElement): void {
    const scale = Math.min(150, Math.max(80, settings.ui_scale));

    root.style.fontSize = scale === 100 ? '' : `${scale}%`;
}
