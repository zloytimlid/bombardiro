<script setup lang="ts">
import { Head } from '@inertiajs/vue3';
import { ref } from 'vue';
import GameScreen from '@/components/game/GameScreen.vue';
import { useI18n } from '@/composables/useI18n';
import type { Station } from '@/sim/core';

/** Тренировка станции (раздел 11: GET /training/{station}): сценарий с оценкой. */
const props = defineProps<{
    station: Station;
    difficulty: 'training' | 'historical';
    seed: number;
    aircraftConfig: Record<string, unknown>;
    mission: Record<string, unknown>;
    theatre: { name: string; placeholder: boolean; definition: Record<string, unknown> };
}>();

const { t } = useI18n();
const key = ref(0);
void props;
</script>

<template>
    <Head :title="`${t('training.title')}: ${t(`station.${station}`)}`" />
    <GameScreen
        :key="key"
        mode="training"
        :station="station"
        :difficulty="difficulty"
        :seed="seed"
        :aircraft-config="aircraftConfig"
        :mission="mission"
        :theatre="theatre"
        @again="key++"
    />
</template>
