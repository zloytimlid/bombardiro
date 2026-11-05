<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from '@/composables/useI18n';
import type { ScreenMarker } from '@/game/boot';
import type { Station, WorldAction } from '@/sim/core';
import type { WorldView } from '@/sim/view';

/**
 * Стрелок (раздел 6.6): кольцевой прицел, боезапас, перегрев, задержка (удержание R),
 * маркер упреждения в «Учебном» режиме. Плюс обязанности места:
 * верхняя турель — бортинженер (пожар, перекачка, аварийный выпуск шасси),
 * бортовой — первая помощь раненым.
 */
const props = defineProps<{ view: WorldView; station: Station; markers: ScreenMarker[]; pointerLocked: boolean }>();
const emit = defineEmits<{ act: [action: WorldAction] }>();
const { t } = useI18n();

const mount = computed(() => props.view.mounts.find((m) => m.station === props.station && !m.fixed));
const me = computed(() => props.view.crew.find((c) => c.station === props.station));
const wounded = computed(() => props.view.crew.filter((c) => c.health === 'wounded' && c.station !== props.station && !c.bailedOut));
</script>

<template>
    <!-- Кольцевой прицел в центре экрана. -->
    <svg class="pointer-events-none absolute top-1/2 left-1/2 h-48 w-48 -translate-x-1/2 -translate-y-1/2" viewBox="0 0 100 100" data-test="ring-sight">
        <circle cx="50" cy="50" r="40" fill="none" stroke="#fde68a" stroke-width="0.8" />
        <circle cx="50" cy="50" r="20" fill="none" stroke="#fde68a" stroke-width="0.6" />
        <circle cx="50" cy="50" r="1.2" fill="#fde68a" />
        <line x1="50" y1="2" x2="50" y2="12" stroke="#fde68a" stroke-width="0.6" />
        <line x1="50" y1="88" x2="50" y2="98" stroke="#fde68a" stroke-width="0.6" />
        <line x1="2" y1="50" x2="12" y2="50" stroke="#fde68a" stroke-width="0.6" />
        <line x1="88" y1="50" x2="98" y2="50" stroke="#fde68a" stroke-width="0.6" />
    </svg>

    <div v-for="m in markers" :key="m.id" class="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rotate-45 border-2 border-emerald-300" :style="{ left: `${m.x}px`, top: `${m.y}px` }" data-test="lead-marker" />

    <div v-if="!pointerLocked" class="pointer-events-none absolute top-1/2 left-1/2 mt-28 -translate-x-1/2 rounded bg-black/60 px-3 py-1 text-sm">{{ t('gunner.click_to_aim') }}</div>

    <div class="pointer-events-auto absolute right-3 bottom-44 w-56 space-y-1 rounded-md bg-black/65 p-2 text-xs" data-test="gunner-panel">
        <template v-if="mount">
            <div class="flex justify-between">
                <span>{{ t('gunner.ammo') }}</span><span class="font-mono" data-test="ammo">{{ mount.ammo }}</span>
            </div>
            <div>
                {{ t('gunner.heat') }}
                <div class="h-2 rounded bg-stone-700"><div class="h-2 rounded" :class="mount.heat > 0.75 ? 'bg-red-500' : 'bg-amber-400'" :style="{ width: `${Math.round(mount.heat * 100)}%` }" /></div>
            </div>
            <div v-if="mount.jammed" class="font-semibold text-red-400">{{ t('gunner.jammed') }} {{ Math.round(mount.clearProgress * 100) }}%</div>
            <div v-if="mount.disabled" class="font-semibold text-red-400">{{ t('gunner.disabled') }}</div>
        </template>
        <div v-if="me?.task" class="text-amber-300">{{ t(`task.${me.task}`) }}…</div>

        <template v-if="station === 'top_gunner'">
            <button v-if="view.damage.fuselageFire" class="w-full rounded bg-red-800 px-2 py-0.5" @click="emit('act', { type: 'task', kind: 'extinguish' })">{{ t('task.extinguish') }}</button>
            <button v-if="view.damage.leakKgS > 0.05" class="w-full rounded bg-stone-700 px-2 py-0.5" @click="emit('act', { type: 'task', kind: 'fuel_transfer' })">{{ t('task.fuel_transfer') }}</button>
            <button v-if="view.aircraft.gear < 0.9 && view.aircraft.hydraulicPressure < 0.3" class="w-full rounded bg-stone-700 px-2 py-0.5" @click="emit('act', { type: 'task', kind: 'emergency_gear' })">{{ t('task.emergency_gear') }}</button>
        </template>
        <template v-if="station === 'waist_gunner'">
            <button v-for="w in wounded" :key="w.station" class="w-full rounded bg-emerald-900 px-2 py-0.5" @click="emit('act', { type: 'task', kind: 'first_aid', target: w.station })">
                {{ t('task.first_aid') }}: {{ t(`station.${w.station}`) }}
            </button>
        </template>
        <p class="text-stone-400">{{ t('gunner.keys') }}</p>
    </div>
</template>
