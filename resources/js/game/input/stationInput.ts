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

    constructor(
        private readonly target: Window,
        private readonly canvas: HTMLCanvasElement,
    ) {
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

        if (this.station === 'bombardier' && this.scope) {
            // Перекрестье: вперёд/назад по пути и вбок, метры на земле.
            this.push({ type: 'sight_adjust', along: -e.movementY * CROSSHAIR_SENSITIVITY, across: e.movementX * CROSSHAIR_SENSITIVITY });

            return;
        }

        if (this.gunMode()) {
            this.gun = {
                az: wrapPi(this.gun.az + e.movementX * GUN_SENSITIVITY),
                el: clamp(this.gun.el - e.movementY * GUN_SENSITIVITY, -1.3, 1.5),
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

        const v = this.lastView;
        const flying = this.station === 'pilot' || (this.station === 'copilot' && v?.flyingStation === 'copilot');

        switch (e.code) {
            case 'KeyG':
                if (this.station === 'pilot' || this.station === 'copilot') {
                    this.push({ type: 'gear', down: !(v?.orders.gearDown ?? v?.copilot.gearDown ?? true) });
                }
                break;
            case 'KeyF':
                if (this.station === 'pilot' || this.station === 'copilot') {
                    const current = v?.orders.flaps ?? v?.copilot.flaps ?? 0;

                    this.push({ type: 'flaps', value: clamp(Math.round((current + (e.shiftKey ? -0.25 : 0.25)) * 4) / 4, 0, 1) });
                }
                break;
            case 'KeyC':
                if (this.station === 'copilot' && v) {
                    const next = nextChecklistItem(v);

                    if (next) {
                        this.push({ type: 'checklist', list: next.list, item: next.item });
                    }
                }
                break;
            case 'KeyT':
                if (this.station === 'bombardier' || this.station === 'radio') {
                    this.toggleScope();
                }
                break;
            case 'KeyO':
                if (this.station === 'bombardier') {
                    this.push({ type: 'doors', open: !(v?.sight.doorsCommand ?? false) });
                }
                break;
            case 'KeyR':
                if (this.station === 'bombardier' && this.scope) {
                    this.push({ type: 'arm', on: !(v?.sight.armed ?? false) });
                }
                break;
            case 'Space':
                e.preventDefault();

                if (this.station === 'bombardier') {
                    this.push(e.shiftKey ? { type: 'salvo' } : { type: 'release' });
                } else if (this.station === 'radio' && !this.scope) {
                    this.push({ type: 'intercom', key: 'intercom.position_report' });
                }
                break;
            case 'ArrowUp':
            case 'ArrowDown':
                if (this.station === 'bombardier') {
                    e.preventDefault();
                    this.push({ type: 'sight_adjust', rate: e.code === 'ArrowUp' ? 0.5 : -0.5 });
                }
                break;
            case 'ArrowLeft':
            case 'ArrowRight':
                if (this.station === 'bombardier') {
                    e.preventDefault();
                    this.push({ type: 'sight_adjust', drift: e.code === 'ArrowRight' ? 0.003 : -0.003 });
                }
                break;
            default:
                break;
        }

        void flying;
    }

    private keyUp(e: KeyboardEvent): void {
        this.pressed.delete(e.code);
    }

    private axis(positive: string, negative: string, value: number, dt: number, rate = 2.2): number {
        const up = this.pressed.has(positive);
        const down = this.pressed.has(negative);

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

        if (flying) {
            this.axes.pitch = this.axis('KeyS', 'KeyW', this.axes.pitch, dt);
            this.axes.roll = this.axis('KeyD', 'KeyA', this.axes.roll, dt);
            this.axes.yaw = this.axis('KeyX', 'KeyZ', this.axes.yaw, dt);

            const up = this.pressed.has('ShiftLeft') || this.pressed.has('ShiftRight');
            const down = this.pressed.has('ControlLeft') || this.pressed.has('ControlRight');

            if (!this.pressed.has('KeyF')) {
                const delta = ((up ? 1 : 0) - (down ? 1 : 0)) * 0.45 * dt;

                this.throttle = [clamp(this.throttle[0] + delta, 0, 1), clamp(this.throttle[1] + delta, 0, 1)];
            }

            const brakes = this.pressed.has('KeyB') ? 1 : 0;

            controls.flight = {
                pitch: this.axes.pitch,
                roll: this.axes.roll,
                yaw: this.axes.yaw,
                brakeLeft: brakes,
                brakeRight: brakes,
                trimPitchRate: (this.pressed.has('BracketRight') ? 1 : 0) - (this.pressed.has('BracketLeft') ? 1 : 0),
                trimRollRate: 0,
                trimYawRate: 0,
                throttle: this.throttle,
                fireFixed: this.station === 'pilot' && this.pressed.has('Space'),
            };
        }

        if (this.gunMode()) {
            const mount = this.mountFor(view);

            if (mount) {
                const command: MountCommand = { az: this.gun.az, el: this.gun.el, fire: this.firing && this.pointerLocked, clearJam: this.pressed.has('KeyR') };

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
