<script setup lang="ts">
import { Head } from '@inertiajs/vue3';
import { computed, ref } from 'vue';
import BriefingView from '@/components/game/BriefingView.vue';
import GameScreen from '@/components/game/GameScreen.vue';
import { useI18n } from '@/composables/useI18n';
import type { MissionDefinition, Station } from '@/sim/core';
import { parseMission } from '@/sim/core';

/**
 * Одиночный вылет (этап 2): брифинг → вылет (игрок на одной станции, 1–8 — переход,
 * остальные места — ИИ) → разбор. Серверный разбор и flight_sessions — этап 3.
 */
const props = defineProps<{
    mission: { slug: string; title: { ru: string; en: string }; placeholder: boolean; version: number; definition: Record<string, unknown> };
    seed: number;
    aircraftConfig: Record<string, unknown>;
    theatre: { name: string; placeholder: boolean; definition: Record<string, unknown> & { origin_lat: number; origin_lon: number } };
    maxTimeScale: number;
}>();

const { t, locale } = useI18n();
const parsed = computed<MissionDefinition>(() => parseMission(JSON.parse(JSON.stringify(props.mission.definition))));
const title = computed(() => props.mission.title[locale.value]);
const step = ref<'briefing' | 'flight'>('briefing');
const station = ref<Station>('pilot');
const difficulty = ref<'training' | 'historical'>('training');
const run = ref(0);

function start(s: Station, d: 'training' | 'historical'): void {
    station.value = s;
    difficulty.value = d;
    step.value = 'flight';
}
</script>

<template>
    <Head :title="`${t('missions.sortie')}: ${title}`" />
    <div class="relative h-screen w-screen overflow-hidden bg-black">
        <BriefingView v-if="step === 'briefing'" :mission="parsed" :title="title" :placeholder="mission.placeholder" :theatre="theatre.definition" @start="start" />
        <GameScreen
            v-else
            :key="run"
            mode="mission"
            :station="station"
            :difficulty="difficulty"
            :seed="seed + run"
            :aircraft-config="aircraftConfig"
            :mission="mission.definition"
            :theatre="theatre"
            :max-time-scale="maxTimeScale"
            @again="step = 'briefing'; run++"
        />
    </div>
</template>
