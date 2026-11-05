<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from '@/composables/useI18n';
import { clockTime } from '@/game/ui/format';
import type { MissionDefinition, Station } from '@/sim/core';
import { STATIONS, toEnu } from '@/sim/core';

/**
 * Брифинг (раздел 8.2, фаза 1): общий и ролевой. Штурману — маршрут и окно времени,
 * бомбардиру — цель и точка прицеливания, радисту — частоты и коды дня, стрелкам — силуэты.
 * Игрок выбирает станцию; остальные места займёт ИИ.
 */
const props = defineProps<{ mission: MissionDefinition; title: string; placeholder: boolean; theatre: { origin_lat: number; origin_lon: number } }>();
const emit = defineEmits<{ start: [station: Station, difficulty: 'training' | 'historical'] }>();
const { t, locale } = useI18n();

const tab = ref<Station | 'general'>('general');
const station = ref<Station>('pilot');
const difficulty = ref<'training' | 'historical'>('training');
const text = (v: { ru: string; en: string }): string => v[locale.value];

const map = computed(() => {
    const pts = props.mission.waypoints.map((w) => ({ id: w.id, type: w.type, p: toEnu(props.theatre, w.lat, w.lon) }));
    const xs = pts.map((p) => p.p.x);
    const ys = pts.map((p) => p.p.y);
    const minX = Math.min(...xs) - 6000;
    const maxX = Math.max(...xs) + 6000;
    const minY = Math.min(...ys) - 6000;
    const maxY = Math.max(...ys) + 6000;
    const w = 520;
    const h = Math.round((w * (maxY - minY)) / (maxX - minX));
    const sx = (x: number): number => ((x - minX) / (maxX - minX)) * w;
    const sy = (y: number): number => h - ((y - minY) / (maxY - minY)) * h;
    const flak = props.mission.threats.flak.map((f) => {
        const p = toEnu(props.theatre, f.lat, f.lon);

        return { id: f.id, x: sx(p.x), y: sy(p.y), heavy: f.type === 'heavy' };
    });

    return { w, h, points: pts.map((p) => ({ ...p, x: sx(p.p.x), y: sy(p.p.y) })), flak };
});
</script>

<template>
    <div class="absolute inset-0 overflow-auto bg-stone-950 p-6 text-stone-100" data-test="briefing">
        <div class="mx-auto max-w-5xl space-y-4">
            <div>
                <h1 class="text-2xl font-semibold">{{ t('briefing.title', { mission: title }) }}</h1>
                <p v-if="placeholder" class="text-amber-300">{{ t('briefing.placeholder') }}</p>
            </div>

            <div class="flex flex-wrap gap-1">
                <button class="rounded px-3 py-1 text-sm" :class="tab === 'general' ? 'bg-amber-700' : 'bg-stone-800'" @click="tab = 'general'">{{ t('briefing.general') }}</button>
                <button v-for="s in STATIONS" :key="s" class="rounded px-3 py-1 text-sm" :class="tab === s ? 'bg-amber-700' : 'bg-stone-800'" @click="tab = s">{{ t(`station.${s}`) }}</button>
            </div>

            <div class="grid grid-cols-[1fr_auto] gap-4">
                <div class="space-y-3 text-sm leading-relaxed">
                    <p v-if="tab === 'general'">{{ text(mission.briefing.general) }}</p>
                    <p v-else>{{ text(mission.briefing.roles[tab]) }}</p>

                    <div class="grid grid-cols-2 gap-2 text-xs">
                        <div class="rounded bg-stone-800 p-2">{{ t('briefing.tot') }}: {{ clockTime(mission.time_over_target.at_s) }} ± {{ mission.time_over_target.window_s }} s</div>
                        <div class="rounded bg-stone-800 p-2">{{ t('briefing.loadout') }}: {{ mission.loadout.bombs.map((b) => `${b.count} × ${b.type}`).join(', ') }}</div>
                        <div class="rounded bg-stone-800 p-2">
                            {{ t('briefing.weather') }}: {{ t('briefing.visibility', { km: Math.round(mission.weather.visibility_m / 1000) }) }};
                            <span v-for="w in mission.weather.wind" :key="w.altitude_m">{{ w.altitude_m }} m — {{ w.from_deg }}° {{ w.speed_ms }} m/s; </span>
                        </div>
                        <div class="rounded bg-stone-800 p-2">{{ t('briefing.target') }}: {{ text(mission.target.name) }}</div>
                    </div>

                    <div v-if="tab === 'radio'" class="rounded bg-stone-800 p-2 text-xs">
                        <div>{{ t('radio.tower') }} {{ mission.radio.frequencies_mhz.tower }} · {{ t('radio.command') }} {{ mission.radio.frequencies_mhz.command }} · {{ t('radio.base') }} {{ mission.radio.frequencies_mhz.base }} MHz</div>
                        <div v-for="c in mission.radio.code_table" :key="c.group" class="font-mono">{{ c.group }} — {{ t(`radio_meaning.${c.meaning}`) }}</div>
                    </div>
                    <div v-if="tab === 'navigator'" class="rounded bg-stone-800 p-2 font-mono text-xs">
                        <div v-for="w in mission.waypoints" :key="w.id">{{ w.id }} · {{ t(`waypoint.${w.type}`) }} · {{ w.alt_m }} m</div>
                    </div>
                </div>

                <svg :width="map.w" :height="map.h" class="rounded bg-[#e8e0c8]" data-test="briefing-map">
                    <polyline :points="map.points.map((p) => `${p.x},${p.y}`).join(' ')" fill="none" stroke="#7c2d12" stroke-width="1.5" stroke-dasharray="4 3" />
                    <g v-for="p in map.points" :key="p.id">
                        <circle :cx="p.x" :cy="p.y" r="3" :fill="p.type === 'target' ? '#991b1b' : '#44403c'" />
                        <text :x="p.x + 4" :y="p.y - 4" font-size="10" fill="#1c1917">{{ p.id }}</text>
                    </g>
                    <circle v-for="f in map.flak" :key="f.id" :cx="f.x" :cy="f.y" :r="f.heavy ? 14 : 6" fill="rgba(185,28,28,0.18)" stroke="#991b1b" stroke-width="0.6" />
                </svg>
            </div>

            <div class="flex flex-wrap items-center gap-3 rounded bg-stone-900 p-3 text-sm">
                <label>
                    {{ t('briefing.your_station') }}
                    <select v-model="station" class="ml-1 rounded bg-stone-800 px-2 py-1" data-test="briefing-station">
                        <option v-for="s in STATIONS" :key="s" :value="s">{{ t(`station.${s}`) }}</option>
                    </select>
                </label>
                <label>
                    {{ t('briefing.difficulty') }}
                    <select v-model="difficulty" class="ml-1 rounded bg-stone-800 px-2 py-1">
                        <option value="training">{{ t('difficulty.training') }}</option>
                        <option value="historical">{{ t('difficulty.historical') }}</option>
                    </select>
                </label>
                <span class="text-stone-400">{{ t('briefing.ai_note') }}</span>
                <button class="ml-auto rounded bg-amber-600 px-4 py-2 font-semibold" data-test="briefing-start" @click="emit('start', station, difficulty)">{{ t('briefing.start') }}</button>
            </div>
        </div>
    </div>
</template>
