<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from '@/composables/useI18n';
import { clockTime, fixed } from '@/game/ui/format';
import type { Debrief, Station } from '@/sim/core';
import { STATIONS } from '@/sim/core';

/**
 * Разбор (раздел 8.2, фаза 10; экран раздела 12): итог команды, результат по цели, время над целью,
 * состояние экипажа, трек на карте, таймлайн, карточки метрик станций, схема разрывов.
 */
const props = defineProps<{ debrief: Debrief; you: Station }>();
const emit = defineEmits<{ again: []; exit: [] }>();
const { t } = useI18n();
const selected = ref<Station>(props.you);

const track = computed(() => {
    const pts = props.debrief.track;

    if (pts.length === 0) {
        return { points: '', w: 300, h: 200 };
    }

    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const minX = Math.min(...xs) - 2000;
    const maxX = Math.max(...xs) + 2000;
    const minY = Math.min(...ys) - 2000;
    const maxY = Math.max(...ys) + 2000;
    const w = 360;
    const h = Math.max(120, Math.round((w * (maxY - minY)) / (maxX - minX)));

    return { points: pts.map((p) => `${((p.x - minX) / (maxX - minX)) * w},${h - ((p.y - minY) / (maxY - minY)) * h}`).join(' '), w, h };
});
const impactScale = 0.9;
</script>

<template>
    <div class="absolute inset-0 overflow-auto bg-stone-950/95 p-6 text-stone-100" data-test="debrief" :data-outcome="debrief.outcome" :data-score="debrief.score.total">
        <div class="mx-auto max-w-5xl space-y-5">
            <div class="flex items-end justify-between">
                <div>
                    <h1 class="text-2xl font-semibold">{{ t('debrief.title') }}</h1>
                    <p class="text-stone-400">{{ t(`outcome.${debrief.outcome}`) }} · {{ clockTime(debrief.durationS) }}</p>
                </div>
                <div class="text-right">
                    <div class="text-4xl font-bold text-amber-300">{{ debrief.score.total }}</div>
                    <div class="text-xs text-stone-400">{{ t('debrief.team_score') }}</div>
                </div>
            </div>

            <div class="grid grid-cols-4 gap-3 text-sm">
                <div v-for="(v, k) in debrief.score.parts" :key="k" class="rounded bg-stone-800 p-3">
                    <div class="text-stone-400">{{ t(`debrief.part.${k}`) }}</div>
                    <div class="text-xl font-semibold">{{ Math.round(v * 100) }}%</div>
                </div>
            </div>

            <div class="grid grid-cols-3 gap-3 text-sm">
                <div class="rounded bg-stone-800 p-3">
                    <div class="font-semibold">{{ t('debrief.target') }}</div>
                    <div>{{ t(`target_status.${debrief.target.status}`) }} · {{ debrief.target.percent }}%</div>
                    <div v-if="!debrief.target.attackedKnownTarget" class="text-amber-300">{{ t('debrief.wrong_target') }}</div>
                </div>
                <div class="rounded bg-stone-800 p-3">
                    <div class="font-semibold">{{ t('debrief.tot') }}</div>
                    <div>
                        {{ clockTime(debrief.timeOverTarget.actualS) }} / {{ clockTime(debrief.timeOverTarget.plannedS) }}
                        <span v-if="debrief.timeOverTarget.deviationS !== null">({{ debrief.timeOverTarget.deviationS > 0 ? '+' : '' }}{{ debrief.timeOverTarget.deviationS }} s)</span>
                    </div>
                    <div :class="debrief.timeOverTarget.withinWindow ? 'text-emerald-300' : 'text-amber-300'">{{ debrief.timeOverTarget.withinWindow ? t('debrief.in_window') : t('debrief.out_window') }}</div>
                </div>
                <div class="rounded bg-stone-800 p-3">
                    <div class="font-semibold">{{ t('debrief.crew') }}</div>
                    <div v-for="c in debrief.crew" :key="c.station" class="flex justify-between text-xs">
                        <span>{{ t(`station.${c.station}`) }}{{ c.ai ? '' : ` (${t('hud.you')})` }}</span>
                        <span>{{ c.bailedOut ? t('crew.bailed_out') : t(`health.${c.health}`) }}</span>
                    </div>
                </div>
            </div>

            <div class="grid grid-cols-2 gap-3">
                <div class="rounded bg-stone-800 p-3">
                    <div class="mb-2 font-semibold">{{ t('debrief.track') }}</div>
                    <svg :width="track.w" :height="track.h" class="rounded bg-stone-900"><polyline :points="track.points" fill="none" stroke="#fbbf24" stroke-width="1.5" /></svg>
                </div>
                <div class="rounded bg-stone-800 p-3">
                    <div class="mb-2 font-semibold">{{ t('debrief.impacts') }}</div>
                    <!-- Схема разрывов: цель в центре, ось атаки вверх, сетка 50 м. -->
                    <svg width="260" height="260" viewBox="-130 -130 260 260" class="rounded bg-[#3f3a2f]" data-test="impact-scheme">
                        <circle v-for="r in [50, 100]" :key="r" cx="0" cy="0" :r="r * impactScale" fill="none" stroke="#a8a29e" stroke-width="0.6" stroke-dasharray="3 3" />
                        <rect x="-4" y="-80" width="8" height="160" fill="#78716c" />
                        <circle v-for="(i, n) in debrief.impacts" :key="n" :cx="i.across * impactScale" :cy="-i.along * impactScale" r="5" :fill="i.armed ? '#ef4444' : '#a3a3a3'" />
                    </svg>
                </div>
            </div>

            <div class="rounded bg-stone-800 p-3">
                <div class="mb-2 flex flex-wrap gap-1">
                    <button v-for="s in STATIONS" :key="s" class="rounded px-2 py-0.5 text-xs" :class="s === selected ? 'bg-amber-700' : 'bg-stone-700'" @click="selected = s">{{ t(`station.${s}`) }}</button>
                </div>
                <div class="grid grid-cols-3 gap-2 text-sm" :data-test="`metrics-${selected}`">
                    <div v-for="m in debrief.stations[selected]" :key="m.key" class="rounded bg-stone-900 p-2">
                        <div class="text-xs text-stone-400">{{ t(`metric.${m.key}`) }}</div>
                        <div class="font-mono">{{ m.value === null ? '—' : fixed(m.value, Number.isInteger(m.value) ? 0 : 1) }} {{ m.unit }}</div>
                    </div>
                </div>
                <p class="mt-2 text-xs text-stone-400">{{ t('debrief.metrics_note') }}</p>
            </div>

            <div class="rounded bg-stone-800 p-3 text-xs">
                <div class="mb-2 font-semibold">{{ t('debrief.timeline') }}</div>
                <div v-for="(e, i) in debrief.timeline" :key="i" class="font-mono">
                    {{ clockTime(e.t) }} — {{ t(`event.${e.type}`) }}
                    <span class="text-stone-400">{{ e.type === 'phase' ? t(`phase.${String(e.payload.to)}`) : '' }}</span>
                </div>
            </div>

            <div class="flex gap-3">
                <button class="rounded bg-amber-600 px-4 py-2" @click="emit('again')">{{ t('debrief.again') }}</button>
                <button class="rounded bg-stone-700 px-4 py-2" @click="emit('exit')">{{ t('training.exit') }}</button>
            </div>
        </div>
    </div>
</template>
