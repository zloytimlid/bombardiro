<script setup lang="ts">
import { Head, router, usePage } from '@inertiajs/vue3';
import { computed, onBeforeUnmount, ref } from 'vue';
import Heading from '@/components/Heading.vue';
import { useI18n } from '@/composables/useI18n';
import type { AxisName, BindingAction } from '@/game/input/bindings';
import { BINDING_GROUPS, codeLabel, DEFAULT_BINDINGS, resolveBindings } from '@/game/input/bindings';
import { api, ApiError } from '@/game/net/api';
import { applyUiScale, DEFAULT_SETTINGS, withDefaults } from '@/game/settings';
import type { UserSettingsData } from '@/types/generated/net';

/**
 * Настройки игры (раздел 12): переназначение клавиш и кнопок геймпада, оси HOTAS с мёртвой зоной
 * и кривой, графика, громкость по категориям, доступность. Хранятся на сервере (PUT /api/me/settings).
 */
defineOptions({ layout: { breadcrumbs: [{ title: 'game_settings.title', href: '/settings/game' }] } });

const { t } = useI18n();
const page = usePage();
const form = ref<UserSettingsData>(structuredClone(withDefaults(page.props.settings as UserSettingsData | null)));
const bindings = ref(resolveBindings(form.value.bindings));
const capturing = ref<{ action: BindingAction; slot: number } | null>(null);
const capturingAxis = ref<AxisName | null>(null);
const saved = ref(false);
const error = ref<string | null>(null);
const busy = ref(false);
const VOLUME_KEYS = ['master', 'engines', 'weapons', 'intercom', 'ui'] as const;
const AXES: AxisName[] = ['pitch', 'roll', 'yaw', 'throttle'];
const volumes = ref<Record<string, number>>({ master: 0.8, engines: 0.8, weapons: 0.9, intercom: 0.8, ui: 0.6, ...(form.value.volumes ?? {}) });
const axes = ref<Record<string, { index: number; invert: boolean }>>({ ...(form.value.gamepad_axes ?? {}) });
const conflicts = computed(() => {
    const seen = new Map<string, BindingAction[]>();

    for (const group of BINDING_GROUPS) {
        for (const action of group.actions) {
            for (const code of bindings.value[action]) {
                seen.set(code, [...(seen.get(code) ?? []), action]);
            }
        }
    }

    // Один код на разных станциях — нормально (Space); конфликт — внутри одной группы.
    const out = new Set<BindingAction>();

    for (const group of BINDING_GROUPS) {
        for (const action of group.actions) {
            for (const code of bindings.value[action]) {
                if ((seen.get(code) ?? []).filter((a) => group.actions.includes(a)).length > 1) {
                    out.add(action);
                }
            }
        }
    }

    return out;
});

let padTimer: number | null = null;

function onKey(e: KeyboardEvent): void {
    if (capturing.value === null) {
        return;
    }

    e.preventDefault();
    e.stopPropagation();

    if (e.code !== 'Escape') {
        setCode(e.code === 'Backspace' || e.code === 'Delete' ? null : e.code);
    }

    stopCapture();
}

function setCode(code: string | null): void {
    const c = capturing.value;

    if (c === null) {
        return;
    }

    const codes = [...bindings.value[c.action]];

    if (code === null) {
        codes.splice(c.slot, 1);
    } else {
        codes[c.slot] = code;
    }

    bindings.value = { ...bindings.value, [c.action]: codes.filter(Boolean).slice(0, 2) };
}

function startCapture(action: BindingAction, slot: number): void {
    capturing.value = { action, slot };
    window.addEventListener('keydown', onKey, { capture: true });

    // Кнопка или ось геймпада тоже годится.
    const baseline = pads();

    padTimer = window.setInterval(() => {
        const now = pads();

        for (const [code] of now) {
            if (!baseline.has(code)) {
                setCode(code);
                stopCapture();

                return;
            }
        }
    }, 50);
}

function stopCapture(): void {
    capturing.value = null;
    window.removeEventListener('keydown', onKey, { capture: true });

    if (padTimer !== null) {
        window.clearInterval(padTimer);
        padTimer = null;
    }
}

function pads(): Map<string, number> {
    const out = new Map<string, number>();
    const pad = Array.from(navigator.getGamepads?.() ?? []).find((p): p is Gamepad => p !== null && p.connected);

    pad?.buttons.forEach((b, i) => b.pressed && out.set(`gp:b${i}`, 1));
    pad?.axes.forEach((x, i) => Math.abs(x) > 0.6 && out.set(`gp:a${i}${x > 0 ? '+' : '-'}`, x));

    return out;
}

/** Назначить ось: двиньте её до упора — берётся ось с наибольшим изменением. */
function captureAxis(name: AxisName): void {
    capturingAxis.value = name;

    const pad0 = Array.from(navigator.getGamepads?.() ?? []).find((p): p is Gamepad => p !== null && p.connected);
    const start = pad0 ? [...pad0.axes] : [];
    const timer = window.setInterval(() => {
        const pad = Array.from(navigator.getGamepads?.() ?? []).find((p): p is Gamepad => p !== null && p.connected);

        if (!pad) {
            return;
        }

        const moved = pad.axes.map((x, i) => Math.abs(x - (start[i] ?? 0)));
        const best = moved.indexOf(Math.max(...moved));

        if ((moved[best] ?? 0) > 0.7) {
            axes.value = { ...axes.value, [name]: { index: best, invert: false } };
            capturingAxis.value = null;
            window.clearInterval(timer);
        }
    }, 50);

    window.setTimeout(() => {
        window.clearInterval(timer);
        capturingAxis.value = null;
    }, 8000);
}

function restoreDefaults(): void {
    form.value = structuredClone(DEFAULT_SETTINGS);
    bindings.value = resolveBindings(null);
    axes.value = {};
}

function resetBindings(): void {
    bindings.value = resolveBindings(null);
}

async function save(): Promise<void> {
    busy.value = true;
    error.value = null;
    saved.value = false;

    try {
        const payload: UserSettingsData = { ...form.value, bindings: { ...bindings.value }, volumes: { ...volumes.value }, gamepad_axes: { ...axes.value } };

        await api('PUT', '/api/me/settings', payload);
        applyUiScale(payload);
        saved.value = true;
        router.reload({ only: ['settings'] });
    } catch (e) {
        error.value = e instanceof ApiError ? e.message : String(e);
    } finally {
        busy.value = false;
    }
}

onBeforeUnmount(stopCapture);
</script>

<template>
    <Head :title="t('game_settings.title')" />

    <div class="space-y-8" data-test="game-settings">
        <Heading variant="small" :title="t('game_settings.title')" :description="t('game_settings.description')" />

        <!-- Управление -->
        <section class="space-y-3">
            <div class="flex items-center justify-between">
                <h2 class="font-semibold">{{ t('game_settings.controls') }}</h2>
                <button type="button" class="text-sm underline" data-test="reset-bindings" @click="resetBindings">{{ t('game_settings.reset') }}</button>
            </div>
            <p class="text-xs text-muted-foreground">{{ t('game_settings.capture_hint') }}</p>
            <div v-for="group in BINDING_GROUPS" :key="group.id" class="space-y-1">
                <h3 class="text-xs font-semibold text-muted-foreground uppercase">{{ t(`binding_group.${group.id}`) }}</h3>
                <div v-for="action in group.actions" :key="action" class="flex items-center gap-2 text-sm" :data-test="`binding-${action}`">
                    <span class="w-56" :class="conflicts.has(action) ? 'text-red-600' : ''">{{ t(`binding.${action}`) }}</span>
                    <button
                        v-for="slot in [0, 1]"
                        :key="slot"
                        type="button"
                        class="min-w-24 rounded border px-2 py-0.5 font-mono text-xs"
                        :class="capturing?.action === action && capturing.slot === slot ? 'border-amber-500 bg-amber-100 dark:bg-amber-950' : ''"
                        :data-test="`bind-${action}-${slot}`"
                        @click="startCapture(action, slot)"
                    >
                        {{ capturing?.action === action && capturing.slot === slot ? t('game_settings.press_key') : bindings[action][slot] ? codeLabel(bindings[action][slot]!) : '—' }}
                    </button>
                    <span v-if="JSON.stringify(bindings[action]) !== JSON.stringify(DEFAULT_BINDINGS[action])" class="text-xs text-muted-foreground">{{ t('game_settings.changed') }}</span>
                </div>
            </div>
            <p v-if="conflicts.size > 0" class="text-xs text-red-600" data-test="binding-conflict">{{ t('game_settings.conflict') }}</p>
        </section>

        <!-- Геймпад и HOTAS -->
        <section class="space-y-3">
            <h2 class="font-semibold">{{ t('game_settings.gamepad') }}</h2>
            <div v-for="name in AXES" :key="name" class="flex items-center gap-3 text-sm">
                <span class="w-40">{{ t(`axis.${name}`) }}</span>
                <span class="w-28 font-mono text-xs">{{ axes[name] ? t('game_settings.axis_n', { n: axes[name]!.index + 1 }) : '—' }}</span>
                <label v-if="axes[name]" class="flex items-center gap-1 text-xs"><input v-model="axes[name]!.invert" type="checkbox" /> {{ t('game_settings.invert') }}</label>
                <button type="button" class="rounded border px-2 py-0.5 text-xs" @click="captureAxis(name)">{{ capturingAxis === name ? t('game_settings.move_axis') : t('game_settings.assign') }}</button>
            </div>
            <label class="flex items-center gap-3 text-sm">
                <span class="w-40">{{ t('game_settings.deadzone') }}</span>
                <input v-model.number="form.gamepad_deadzone" type="range" min="0" max="0.5" step="0.01" />
                <span class="font-mono text-xs">{{ Math.round(form.gamepad_deadzone * 100) }}%</span>
            </label>
            <label class="flex items-center gap-3 text-sm">
                <span class="w-40">{{ t('game_settings.curve') }}</span>
                <input v-model.number="form.gamepad_curve" type="range" min="1" max="3" step="0.1" />
                <span class="font-mono text-xs">{{ form.gamepad_curve.toFixed(1) }}</span>
            </label>
        </section>

        <!-- Мышь, графика, звук -->
        <section class="grid gap-3 sm:grid-cols-2">
            <label class="flex items-center gap-3 text-sm">
                <span class="w-40">{{ t('game_settings.mouse_sensitivity') }}</span>
                <input v-model.number="form.mouse_sensitivity" type="range" min="0.1" max="5" step="0.1" data-test="mouse-sensitivity" />
                <span class="font-mono text-xs">{{ form.mouse_sensitivity.toFixed(1) }}</span>
            </label>
            <label class="flex items-center gap-2 text-sm"><input v-model="form.invert_y" type="checkbox" /> {{ t('game_settings.invert_y') }}</label>
            <label class="flex items-center gap-3 text-sm">
                <span class="w-40">{{ t('game_settings.graphics') }}</span>
                <select v-model="form.graphics" class="rounded border bg-background px-2 py-1" data-test="graphics">
                    <option value="low">{{ t('game_settings.preset_low') }}</option>
                    <option value="medium">{{ t('game_settings.preset_medium') }}</option>
                    <option value="high">{{ t('game_settings.preset_high') }}</option>
                </select>
            </label>
            <label class="flex items-center gap-3 text-sm">
                <span class="w-40">{{ t('game_settings.render_scale') }}</span>
                <input v-model.number="form.render_scale" type="range" min="0.5" max="1.5" step="0.05" />
                <span class="font-mono text-xs">{{ Math.round(form.render_scale * 100) }}%</span>
            </label>
            <label class="flex items-center gap-2 text-sm"><input v-model="form.shadows" type="checkbox" /> {{ t('game_settings.shadows') }}</label>
            <label class="flex items-center gap-3 text-sm">
                <span class="w-40">{{ t('game_settings.renderer') }}</span>
                <select v-model="form.renderer" class="rounded border bg-background px-2 py-1" data-test="renderer">
                    <option value="webgl">{{ t('game_settings.renderer_webgl') }}</option>
                    <option value="webgpu">{{ t('game_settings.renderer_webgpu') }}</option>
                </select>
            </label>
        </section>

        <section class="space-y-2">
            <h2 class="font-semibold">{{ t('game_settings.sound') }}</h2>
            <label v-for="k in VOLUME_KEYS" :key="k" class="flex items-center gap-3 text-sm">
                <span class="w-40">{{ t(`volume.${k}`) }}</span>
                <input v-model.number="volumes[k]" type="range" min="0" max="1" step="0.05" :data-test="`volume-${k}`" />
                <span class="font-mono text-xs">{{ Math.round((volumes[k] ?? 0) * 100) }}%</span>
            </label>
        </section>

        <!-- Доступность -->
        <section class="grid gap-3 sm:grid-cols-2">
            <h2 class="font-semibold sm:col-span-2">{{ t('game_settings.accessibility') }}</h2>
            <label class="flex items-center gap-2 text-sm"><input v-model="form.subtitles" type="checkbox" data-test="subtitles" /> {{ t('game_settings.subtitles') }}</label>
            <label class="flex items-center gap-2 text-sm"><input v-model="form.camera_shake" type="checkbox" data-test="camera-shake" /> {{ t('game_settings.camera_shake') }}</label>
            <label class="flex items-center gap-3 text-sm">
                <span class="w-40">{{ t('game_settings.ui_scale') }}</span>
                <input v-model.number="form.ui_scale" type="range" min="80" max="150" step="5" data-test="ui-scale" />
                <span class="font-mono text-xs">{{ form.ui_scale }}%</span>
            </label>
            <label class="flex items-center gap-3 text-sm">
                <span class="w-40">{{ t('game_settings.long_actions') }}</span>
                <select v-model="form.long_actions" class="rounded border bg-background px-2 py-1">
                    <option value="hold">{{ t('game_settings.hold') }}</option>
                    <option value="toggle">{{ t('game_settings.toggle') }}</option>
                </select>
            </label>
            <label class="flex items-center gap-3 text-sm">
                <span class="w-40">{{ t('game_settings.units') }}</span>
                <select v-model="form.units" class="rounded border bg-background px-2 py-1">
                    <option value="imperial">{{ t('game_settings.imperial') }}</option>
                    <option value="metric">{{ t('game_settings.metric') }}</option>
                </select>
            </label>
            <p class="text-xs text-muted-foreground sm:col-span-2">{{ t('game_settings.threat_note') }}</p>
        </section>

        <div class="flex items-center gap-3">
            <button type="button" class="rounded bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50" :disabled="busy" data-test="save-settings" @click="save">{{ t('ui.save') }}</button>
            <button type="button" class="text-sm underline" @click="restoreDefaults">{{ t('game_settings.defaults') }}</button>
            <span v-if="saved" class="text-sm text-green-600" data-test="settings-saved">{{ t('game_settings.saved') }}</span>
            <span v-if="error" class="text-sm text-red-600">{{ error }}</span>
        </div>
    </div>
</template>
