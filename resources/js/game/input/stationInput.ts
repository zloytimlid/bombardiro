import type { AxisBindings, AxisName, BindingAction, Bindings } from './bindings';
import { DEFAULT_AXES, indexBindings, resolveBindings, shapeAxis } from './bindings';
import type { ChecklistId, HumanControls, MountCommand, Station, WorldAction } from '@/sim/core';
import { clamp, wrapPi } from '@/sim/core';
import type { WorldView } from '@/sim/view';

/**
 * Ввод игрока на текущей станции (раздел 12). Непрерывные органы (штурвал, РУД, наведение
 * пулемёта) — каждый кадр; дискретные действия (шасси, люк, сброс) — очередью в воркер.
 *
 * Пилот: W/S, A/D, Z/X, Shift/Ctrl — РУД, B — тормоза, Space — курсовые пулемёты, G — шасси, F/Shift+F — закрылки, [ ] — триммер.
 * Второй пилот: G, F/Shift+F, C — следующий пункт чек-листа; после «Взял управление» — органы пилота.
 * Бомбардир: T — окуляр прицела; мышь — перекрестье, колесо — «скорость», Shift+колесо — «снос»,
 *   стрелки — те же ручки, O — люк, R — взведение, Space — сброс, Shift+Space — аварийный сброс.
 * Стрелки (и радист/бомбардир у пулемёта): мышь в Pointer Lock — наведение, ЛКМ — огонь, R (удержание) — задержка.
 * Радист: колесо — шкала частот.
 */
const GUN_SENSITIVITY = 0.0022;
const CROSSHAIR_SENSITIVITY = 1.2;
/** Наведение пулемёта правым стиком геймпада, рад/с на полном отклонении. */
const STICK_GUN_RATE = 1.6;

/** Настройки ввода игрока (раздел 12; UserSettingsData). */
export type InputPrefs = {
    bindings: Bindings;
    axes: AxisBindings;
    deadzone: number;
    curve: number;
    mouseSensitivity: number;
    invertY: boolean;
    /** Длительные действия (тормоза, устранение задержки): удержание или переключение. */
    longActions: 'hold' | 'toggle';
};

export const DEFAULT_INPUT_PREFS: InputPrefs = { bindings: resolveBindings(null), axes: DEFAULT_AXES, deadzone: 0.08, curve: 1.6, mouseSensitivity: 1, invertY: false, longActions: 'hold' };

const LONG_ACTIONS: BindingAction[] = ['brakes', 'clear_jam'];

export class StationInput {
    station: Station = 'pilot';
    /** Бомбардир/радист: вид в окуляр прицела или за пулемётом. */
    scope = false;
    private readonly pressed = new Set<string>();
    private queue: WorldAction[] = [];
    private axes = { pitch: 0, roll: 0, yaw: 0 };
    private throttle: [number, number] = [0, 0];
    private gun = { az: 0, el: 0.1 };
    private firing = false;
    private lastView: WorldView | null = null;
    private readonly listeners: [EventTarget, string, EventListener][] = [];
    private prefs: InputPrefs = DEFAULT_INPUT_PREFS;
    private index = indexBindings(DEFAULT_INPUT_PREFS.bindings);
    /** Переключаемые длительные действия (режим «переключение»). */
    private readonly latched = new Set<BindingAction>();
    private padPressed = new Set<string>();

    constructor(
        private readonly target: Window,
        private readonly canvas: HTMLCanvasElement,
        prefs?: InputPrefs,
    ) {
        if (prefs) {
            this.setPrefs(prefs);
        }

        this.listen(target, 'keydown', (e) => this.keyDown(e as KeyboardEvent));
        this.listen(target, 'keyup', (e) => this.keyUp(e as KeyboardEvent));
        this.listen(target, 'blur', () => {
            this.pressed.clear();
            this.firing = false;
        });
        this.listen(canvas, 'mousedown', (e) => this.mouseDown(e as MouseEvent));
        this.listen(target, 'mouseup', (e) => {
            if ((e as MouseEvent).button === 0) {
                this.firing = false;
            }
        });
        this.listen(target, 'mousemove', (e) => this.mouseMove(e as MouseEvent));
        this.listen(canvas, 'wheel', (e) => this.wheel(e as WheelEvent));
    }

    setPrefs(prefs: InputPrefs): void {
        this.prefs = prefs;
        this.index = indexBindings(prefs.bindings);
        this.latched.clear();
    }

    /** Действия, назначенные на код (клавиша или кнопка геймпада). */
    actionsFor(code: string): BindingAction[] {
        return this.index.get(code) ?? [];
    }

    private isDown(action: BindingAction): boolean {
        return this.prefs.bindings[action].some((code) => this.pressed.has(code));
    }

    private isHeld(action: BindingAction): boolean {
        return this.prefs.longActions === 'toggle' && LONG_ACTIONS.includes(action) ? this.latched.has(action) : this.isDown(action);
    }

    private listen(target: EventTarget, type: string, fn: EventListener): void {
        target.addEventListener(type, fn, { passive: false });
        this.listeners.push([target, type, fn]);
    }

    dispose(): void {
        for (const [t, type, fn] of this.listeners) {
            t.removeEventListener(type, fn);
        }

        if (document.pointerLockElement === this.canvas) {
            document.exitPointerLock();
        }
    }

    get pointerLocked(): boolean {
        return document.pointerLockElement === this.canvas;
    }

    /** Нужен ли станции захват мыши (наведение пулемёта или перекрестья). */
    wantsPointer(): boolean {
        return this.gunMode() || (this.station === 'bombardier' && this.scope);
    }

    gunMode(): boolean {
        const s = this.station;

        if (s === 'top_gunner' || s === 'waist_gunner' || s === 'tail_gunner') {
            return true;
        }

        // Радист: T — к левому бортовому пулемёту; бомбардир: T — от носового пулемёта к прицелу.
        return (s === 'radio' && this.scope) || (s === 'bombardier' && !this.scope);
    }

    /** Смена станции: органы берут текущее положение из мира, чтобы не было рывка. */
    setStation(station: Station, view: WorldView | null): void {
        this.station = station;
        this.scope = false;
        this.firing = false;
        this.axes = { pitch: 0, roll: 0, yaw: 0 };

        if (view) {
            this.throttle = [...view.pilotThrottle];

            const mount = this.mountFor(view);

            if (mount) {
                this.gun = { az: mount.az, el: mount.el };
            }
        }
    }

    toggleScope(): void {
        this.scope = !this.scope;

        if (!this.wantsPointer() && this.pointerLocked) {
            document.exitPointerLock();
        }
    }

    push(action: WorldAction): void {
        this.queue.push(action);
    }

    get aim(): { az: number; el: number } {
        return this.gun;
    }

    mountFor(view: WorldView): WorldView['mounts'][number] | undefined {
        const candidates = view.mounts.filter((m) => m.station === this.station && !m.fixed);

        return candidates[0];
    }

    private mouseDown(e: MouseEvent): void {
        if (e.button !== 0) {
            return;
        }

        if (this.wantsPointer() && !this.pointerLocked) {
            void this.canvas.requestPointerLock();

            return;
        }

        if (this.gunMode()) {
            this.firing = true;
        }
    }

    private mouseMove(e: MouseEvent): void {
        if (!this.pointerLocked) {
            return;
        }

        const k = this.prefs.mouseSensitivity;
        const dy = this.prefs.invertY ? -e.movementY : e.movementY;

        if (this.station === 'bombardier' && this.scope) {
            // Перекрестье: вперёд/назад по пути и вбок, метры на земле.
            this.push({ type: 'sight_adjust', along: -dy * CROSSHAIR_SENSITIVITY * k, across: e.movementX * CROSSHAIR_SENSITIVITY * k });

            return;
        }

        if (this.gunMode()) {
            this.gun = {
                az: wrapPi(this.gun.az + e.movementX * GUN_SENSITIVITY * k),
                el: clamp(this.gun.el - dy * GUN_SENSITIVITY * k, -1.3, 1.5),
            };
        }
    }

    private wheel(e: WheelEvent): void {
        const step = Math.sign(e.deltaY);

        if (this.station === 'bombardier' && this.scope) {
            e.preventDefault();
            this.push(e.shiftKey ? { type: 'sight_adjust', drift: -step * 0.002 } : { type: 'sight_adjust', rate: -step * 0.25 });
        } else if (this.station === 'radio' && !this.scope && this.lastView) {
            e.preventDefault();
            this.push({ type: 'radio_dial', mhz: clamp(this.lastView.radio.dialMhz - step * (e.shiftKey ? 0.002 : 0.01), 3, 8) });
        }
    }

    private keyDown(e: KeyboardEvent): void {
        const first = !e.repeat;

        this.pressed.add(e.code);

        if (!first) {
            return;
        }

        if (this.press(e.code, e.shiftKey)) {
            // Space и стрелки не должны прокручивать страницу, если на них игровое действие.
            if (e.code === 'Space' || e.code.startsWith('Arrow')) {
                e.preventDefault();
            }
        }
    }

    /** Нажатие кода (клавиатура или геймпад): дискретные действия станции. true — что-то сделано. */
    private press(code: string, shift: boolean): boolean {
        const v = this.lastView;
        let handled = false;

        for (const action of this.actionsFor(code)) {
            if (this.prefs.longActions === 'toggle' && LONG_ACTIONS.includes(action)) {
                if (this.latched.has(action)) {
                    this.latched.delete(action);
                } else {
                    this.latched.add(action);
                }
            }

            switch (action) {
                case 'gear':
                    if (this.station === 'pilot' || this.station === 'copilot') {
                        this.push({ type: 'gear', down: !(v?.orders.gearDown ?? v?.copilot.gearDown ?? true) });
                        handled = true;
                    }
                    break;
                case 'flaps':
                    if (this.station === 'pilot' || this.station === 'copilot') {
                        const current = v?.orders.flaps ?? v?.copilot.flaps ?? 0;

                        this.push({ type: 'flaps', value: clamp(Math.round((current + (shift ? -0.25 : 0.25)) * 4) / 4, 0, 1) });
                        handled = true;
                    }
                    break;
                case 'checklist_next':
                    if (this.station === 'copilot' && v) {
                        const next = nextChecklistItem(v);

                        if (next) {
                            this.push({ type: 'checklist', list: next.list, item: next.item });
                        }

                        handled = true;
                    }
                    break;
                case 'scope':
                    if (this.station === 'bombardier' || this.station === 'radio') {
                        this.toggleScope();
                        handled = true;
                    }
                    break;
                case 'bomb_doors':
                    if (this.station === 'bombardier') {
                        this.push({ type: 'doors', open: !(v?.sight.doorsCommand ?? false) });
                        handled = true;
                    }
                    break;
                case 'arm':
                    if (this.station === 'bombardier' && this.scope) {
                        this.push({ type: 'arm', on: !(v?.sight.armed ?? false) });
                        handled = true;
                    }
                    break;
                case 'release':
                    if (this.station === 'bombardier') {
                        this.push(shift ? { type: 'salvo' } : { type: 'release' });
                        handled = true;
                    }
                    break;
                case 'position_report':
                    if (this.station === 'radio' && !this.scope) {
                        this.push({ type: 'intercom', key: 'intercom.position_report' });
                        handled = true;
                    }
                    break;
                case 'fire_fixed':
                    handled ||= this.station === 'pilot';
                    break;
                case 'sight_rate_up':
                case 'sight_rate_down':
                    if (this.station === 'bombardier') {
                        this.push({ type: 'sight_adjust', rate: action === 'sight_rate_up' ? 0.5 : -0.5 });
                        handled = true;
                    }
                    break;
                case 'sight_drift_left':
                case 'sight_drift_right':
                    if (this.station === 'bombardier') {
                        this.push({ type: 'sight_adjust', drift: action === 'sight_drift_right' ? 0.003 : -0.003 });
                        handled = true;
                    }
                    break;
                default:
                    break;
            }
        }

        return handled;
    }

    /** Геймпад / HOTAS (Gamepad API): кнопки и оси-как-кнопки → коды, фронты нажатий → действия. */
    private pollGamepad(): Gamepad | null {
        const pads = typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
        const pad = Array.from(pads).find((p): p is Gamepad => p !== null && p.connected) ?? null;
        const now = new Set<string>();

        if (pad) {
            pad.buttons.forEach((b, i) => {
                if (b.pressed) {
                    now.add(`gp:b${i}`);
                }
            });
            pad.axes.forEach((x, i) => {
                if (x > 0.5) {
                    now.add(`gp:a${i}+`);
                } else if (x < -0.5) {
                    now.add(`gp:a${i}-`);
                }
            });
        }

        for (const code of now) {
            if (!this.padPressed.has(code)) {
                this.pressed.add(code);
                this.press(code, false);
            }
        }

        for (const code of this.padPressed) {
            if (!now.has(code)) {
                this.pressed.delete(code);
            }
        }

        this.padPressed = now;

        return pad;
    }

    private padAxis(pad: Gamepad | null, name: AxisName): number | null {
        const bind = this.prefs.axes[name];
        const raw = bind && pad ? pad.axes[bind.index] : undefined;

        if (raw === undefined) {
            return null;
        }

        return shapeAxis(bind!.invert ? -raw : raw, this.prefs.deadzone, this.prefs.curve);
    }

    private keyUp(e: KeyboardEvent): void {
        this.pressed.delete(e.code);
    }

    private axis(positive: BindingAction, negative: BindingAction, value: number, dt: number, rate = 2.2): number {
        const up = this.isDown(positive);
        const down = this.isDown(negative);

        if (up === down) {
            return Math.abs(value) < rate * dt * 1.5 ? 0 : value - Math.sign(value) * rate * dt * 1.5;
        }

        return clamp(value + (up ? 1 : -1) * rate * dt, -1, 1);
    }

    /** Ввод за кадр: органы станции и накопленные действия. */
    sample(dt: number, view: WorldView): { controls: HumanControls; actions: WorldAction[] } {
        this.lastView = view;

        const actions = this.queue;
        const controls: HumanControls = {};

        this.queue = [];

        const flying = this.station === 'pilot' || (this.station === 'copilot' && view.flyingStation === 'copilot');
        const pad = this.pollGamepad();

        if (flying) {
            this.axes.pitch = this.axis('pitch_up', 'pitch_down', this.axes.pitch, dt);
            this.axes.roll = this.axis('roll_right', 'roll_left', this.axes.roll, dt);
            this.axes.yaw = this.axis('yaw_right', 'yaw_left', this.axes.yaw, dt);

            // Аналоговые оси геймпада/HOTAS перекрывают клавиши, когда отклонены.
            for (const name of ['pitch', 'roll', 'yaw'] as const) {
                const v = this.padAxis(pad, name);

                if (v !== null && v !== 0) {
                    this.axes[name] = v;
                }
            }

            const up = this.isDown('throttle_up');
            const down = this.isDown('throttle_down');
            const padThrottle = this.padAxis(pad, 'throttle');

            if (padThrottle !== null && this.prefs.axes.throttle !== undefined) {
                // РУД HOTAS: вперёд (−1) — полный газ.
                const t = clamp((1 - padThrottle) / 2, 0, 1);

                this.throttle = [t, t];
            } else if (!this.isDown('flaps')) {
                const delta = ((up ? 1 : 0) - (down ? 1 : 0)) * 0.45 * dt;

                this.throttle = [clamp(this.throttle[0] + delta, 0, 1), clamp(this.throttle[1] + delta, 0, 1)];
            }

            const brakes = this.isHeld('brakes') ? 1 : 0;

            controls.flight = {
                pitch: this.axes.pitch,
                roll: this.axes.roll,
                yaw: this.axes.yaw,
                brakeLeft: brakes,
                brakeRight: brakes,
                trimPitchRate: (this.isDown('trim_up') ? 1 : 0) - (this.isDown('trim_down') ? 1 : 0),
                trimRollRate: 0,
                trimYawRate: 0,
                throttle: this.throttle,
                fireFixed: this.station === 'pilot' && this.isDown('fire_fixed'),
            };
        }

        if (this.gunMode()) {
            const mount = this.mountFor(view);

            // Правый стик геймпада наводит пулемёт; спуск — назначенная кнопка (по умолчанию правый курок).
            if (pad) {
                const ax = shapeAxis(pad.axes[2] ?? 0, this.prefs.deadzone, this.prefs.curve);
                const ay = shapeAxis(pad.axes[3] ?? 0, this.prefs.deadzone, this.prefs.curve) * (this.prefs.invertY ? -1 : 1);

                this.gun = { az: wrapPi(this.gun.az + ax * STICK_GUN_RATE * dt), el: clamp(this.gun.el - ay * STICK_GUN_RATE * dt, -1.3, 1.5) };
            }

            if (mount) {
                const fire = (this.firing && this.pointerLocked) || this.isDown('gun_fire');
                const command: MountCommand = { az: this.gun.az, el: this.gun.el, fire, clearJam: this.isHeld('clear_jam') };

                controls.mount = command;
                controls.mountId = mount.id;
            }
        }

        return { controls, actions };
    }

    /** Положение РУД задаёт интерфейс (кнопки) или старт сцены. */
    setThrottle(value: [number, number]): void {
        this.throttle = [...value];
    }
}

/** Первый невыполненный пункт текущего чек-листа (клавиша C второго пилота). */
export function nextChecklistItem(view: WorldView): { list: ChecklistId; item: string } | null {
    const order: ChecklistId[] = view.phase === 'preflight' ? ['preflight', 'start'] : view.phase === 'takeoff' ? ['takeoff'] : view.phase === 'landing' ? ['landing'] : [];

    for (const list of order) {
        for (const [item, done] of Object.entries(view.checklists[list])) {
            if (!done) {
                return { list, item };
            }
        }
    }

    return null;
}
