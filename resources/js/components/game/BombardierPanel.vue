<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from '@/composables/useI18n';
import { fixed, M_TO_FT, MS_TO_MPH, signedDeg } from '@/game/ui/format';
import type { WorldAction } from '@/sim/core';
import type { WorldView } from '@/sim/view';

/**
 * Бомбардир (раздел 6.4): ввод высоты и скорости, ручки «скорость» и «снос», режим сброса
 * и интервалометр, люк, взведение, сброс и аварийный сброс. В окуляре — перекрестье;
 * в «Учебном» режиме — стрелка смещения цели (в «Историческом» видно только саму цель).
 */
const props = defineProps<{ view: WorldView; scope: boolean }>();
const emit = defineEmits<{ act: [action: WorldAction]; scope: [] }>();
const { t } = useI18n();

const s = computed(() => props.view.sight);
const r = computed(() => props.view.sight.readout);
const errorArrow = computed(() => {
    const e = r.value?.error;

    if (!e || props.view.difficulty !== 'training') {
        return null;
    }

    // Смещение цели на земле → угол в поле зрения (7°) → пиксели индикатора.
    const height = Math.max(s.value.altitudeSetM, 100);
    const scale = 220 / (height * Math.tan((3.5 * Math.PI) / 180));

    return { x: Math.max(-110, Math.min(110, e.across * scale)), y: Math.max(-110, Math.min(110, -e.along * scale)) };
});
const setAlt = (ft: number): void => emit('act', { type: 'sight_set', altitudeM: ft / M_TO_FT });
const setTas = (mph: number): void => emit('act', { type: 'sight_set', tasMs: mph / MS_TO_MPH });
</script>

<template>
    <!-- Окуляр: перекрестье и стрелка смещения. -->
    <div v-if="scope" class="pointer-events-none absolute inset-0 flex items-center justify-center" data-test="bombsight-reticle">
        <div class="relative h-[440px] w-[440px] rounded-full border-[40px] border-black/85">
            <div class="absolute top-0 left-1/2 h-full w-px bg-white/80" />
            <div class="absolute top-1/2 left-0 h-px w-full bg-white/80" />
            <div v-if="errorArrow" class="absolute h-3 w-3 rounded-full border-2 border-amber-300" :style="{ left: `calc(50% + ${errorArrow.x}px - 6px)`, top: `calc(50% + ${errorArrow.y}px - 6px)` }" />
            <div v-if="!s.on" class="absolute inset-0 flex items-center justify-center text-sm text-stone-300">{{ t('bombardier.sight_off') }}</div>
        </div>
    </div>

    <div class="pointer-events-auto absolute top-28 right-3 w-80 space-y-2 rounded-md bg-black/70 p-3 text-xs" data-test="bombardier-panel" :data-rack="s.rack">
        <div class="flex items-center justify-between">
            <span class="font-semibold">{{ t('bombardier.sight') }}</span>
            <span v-if="s.failed" class="text-red-400">{{ t('bombardier.sight_failed') }}</span>
            <button class="rounded bg-stone-700 px-2 py-0.5" @click="emit('scope')">{{ scope ? t('bombardier.to_gun') : t('bombardier.to_sight') }} (T)</button>
        </div>
        <button v-if="!s.on && !s.failed" class="w-full rounded bg-emerald-800 px-2 py-1" data-test="sight-on" @click="emit('act', { type: 'sight_on' })">{{ t('bombardier.sight_on') }}</button>
        <div class="grid grid-cols-2 gap-1">
            <label>{{ t('bombardier.altitude') }} <input type="number" step="50" class="w-20 rounded bg-stone-800 px-1" :value="Math.round(s.altitudeSetM * M_TO_FT)" @change="setAlt(Number(($event.target as HTMLInputElement).value))" /> ft</label>
            <label>{{ t('bombardier.tas') }} <input type="number" step="1" class="w-16 rounded bg-stone-800 px-1" :value="Math.round(s.tasSetMs * MS_TO_MPH)" @change="setTas(Number(($event.target as HTMLInputElement).value))" /> mph</label>
        </div>
        <div class="grid grid-cols-2 gap-1 font-mono">
            <div>
                {{ t('bombardier.rate') }} {{ fixed(s.rateMs * MS_TO_MPH) }}
                <button class="ml-1 rounded bg-stone-700 px-1" @click="emit('act', { type: 'sight_adjust', rate: -0.5 })">−</button>
                <button class="rounded bg-stone-700 px-1" @click="emit('act', { type: 'sight_adjust', rate: 0.5 })">+</button>
            </div>
            <div>
                {{ t('bombardier.drift') }} {{ signedDeg(s.driftRad) }}°
                <button class="ml-1 rounded bg-stone-700 px-1" @click="emit('act', { type: 'sight_adjust', drift: -0.003 })">−</button>
                <button class="rounded bg-stone-700 px-1" @click="emit('act', { type: 'sight_adjust', drift: 0.003 })">+</button>
            </div>
            <div>{{ t('bombardier.sight_angle') }} {{ r ? signedDeg(r.sightAngle) : '—' }}°</div>
            <div>{{ t('bombardier.drop_angle') }} {{ r ? signedDeg(r.dropAngle) : '—' }}°</div>
            <div class="col-span-2" data-test="seconds-to-release">{{ t('bombardier.to_release') }} {{ r && r.secondsToRelease !== null ? fixed(r.secondsToRelease) : '—' }} s</div>
        </div>
        <div class="flex flex-wrap gap-1">
            <button class="rounded px-2 py-0.5" :class="s.mode === 'train' ? 'bg-amber-700' : 'bg-stone-700'" @click="emit('act', { type: 'release_mode', mode: 'train' })">{{ t('bombardier.train') }}</button>
            <button class="rounded px-2 py-0.5" :class="s.mode === 'salvo' ? 'bg-amber-700' : 'bg-stone-700'" @click="emit('act', { type: 'release_mode', mode: 'salvo' })">{{ t('bombardier.salvo_mode') }}</button>
            <label>{{ t('bombardier.interval') }} <input type="number" step="10" min="30" max="1000" class="w-14 rounded bg-stone-800 px-1" :value="s.intervalMs" @change="emit('act', { type: 'release_mode', mode: s.mode, intervalMs: Number(($event.target as HTMLInputElement).value) })" /> ms</label>
        </div>
        <div class="flex flex-wrap gap-1">
            <button class="rounded px-2 py-0.5" :class="s.doorsCommand ? 'bg-amber-700' : 'bg-stone-700'" data-test="doors" @click="emit('act', { type: 'doors', open: !s.doorsCommand })">
                {{ s.doorsCommand ? t('bombardier.doors_open') : t('bombardier.doors_closed') }} (O)
            </button>
            <button class="rounded px-2 py-0.5" :class="s.armed ? 'bg-red-800' : 'bg-stone-700'" data-test="arm" @click="emit('act', { type: 'arm', on: !s.armed })">{{ s.armed ? t('bombardier.armed') : t('bombardier.safe') }} (R)</button>
            <button class="rounded px-2 py-0.5" :class="s.autoRelease ? 'bg-emerald-800' : 'bg-stone-700'" @click="emit('act', { type: 'auto_release', on: !s.autoRelease })">{{ t('bombardier.auto') }}</button>
        </div>
        <div class="flex items-center gap-2">
            <span class="font-mono">{{ t('bombardier.rack', { count: s.rack }) }}</span>
            <button class="rounded bg-amber-700 px-2 py-0.5" data-test="release" @click="emit('act', { type: 'release' })">{{ t('bombardier.release') }} (Space)</button>
            <button class="rounded bg-red-900 px-2 py-0.5" @click="emit('act', { type: 'salvo' })">{{ t('bombardier.emergency') }}</button>
        </div>
        <p class="text-stone-400">{{ t('bombardier.keys') }}</p>
    </div>
</template>
