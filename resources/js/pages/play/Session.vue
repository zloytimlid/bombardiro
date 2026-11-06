<script setup lang="ts">
import { Head, Link, router } from '@inertiajs/vue3';
import { computed, onMounted, ref, shallowRef } from 'vue';
import GameScreen from '@/components/game/GameScreen.vue';
import { useI18n } from '@/composables/useI18n';
import { api, ApiError } from '@/game/net/api';
import type { Station } from '@/sim/core';
import type { NetBootstrapData } from '@/types/generated/net';

const { t } = useI18n();

/**
 * Игровой клиент кооператива (раздел 11: /play/{session}): данные вылета — из bootstrap,
 * дальше мир ведёт хост; по окончании — серверный разбор /debrief/{session}.
 * Повторное открытие в течение 120 с возвращает игрока на его место (раздел 9.3).
 */
const props = defineProps<{ session: string; crew: string }>();

const boot = shallowRef<NetBootstrapData | null>(null);
const error = ref<string | null>(null);

// Отладочная задержка сети (только вне продакшена): ?debug_net_delay=150.
const delayMs = computed(() => {
    if (import.meta.env.PROD) {
        return 0;
    }

    const raw = new URLSearchParams(window.location.search).get('debug_net_delay');

    return raw === null ? 0 : Math.min(1000, Math.max(0, Number(raw) || 0));
});

// Отладка (только вне продакшена): ?debug_graphics=low — E2E с тремя браузерами на одной машине.
const graphics = computed(() => {
    const raw = import.meta.env.PROD ? null : new URLSearchParams(window.location.search).get('debug_graphics');

    return raw === 'low' || raw === 'medium' || raw === 'high' ? raw : undefined;
});
// Звено (этап 6): своё место в строю и имя экипажа для меток самолётов.
const flight = computed(() => {
    const f = boot.value?.flight;

    return f ? { ulid: f.ulid, slot: f.slot, name: f.slots.find((s) => s.slot === f.slot)?.name ?? '' } : null;
});
const seat = computed<Station>(() => (boot.value?.seat ?? 'pilot') as Station);
const difficulty = computed(() => (boot.value?.difficulty === 'historical' ? 'historical' : 'training'));
const humans = computed<Station[]>(() => (boot.value?.roster ?? []).filter((r) => r.user_id !== null).map((r) => r.seat as Station));

onMounted(async () => {
    try {
        const res = await api<{ data: NetBootstrapData }>('GET', `/api/sessions/${props.session}/bootstrap`);

        if (res.data.status === 'finished' || res.data.status === 'aborted') {
            router.visit(`/debrief/${props.session}`);

            return;
        }

        if (res.data.seat === null) {
            error.value = t('session.error.no_seat');

            return;
        }

        boot.value = res.data;
    } catch (e) {
        error.value = e instanceof ApiError ? e.message : String(e);
    }
});

const finished = (): void => router.visit(`/debrief/${props.session}`);
</script>

<template>
    <Head :title="t('session.title')" />
    <div class="relative h-screen w-screen overflow-hidden bg-black text-stone-100" data-test="play">
        <div v-if="error" class="flex h-full items-center justify-center p-6">
            <div class="max-w-md rounded-lg border border-stone-700 bg-stone-900/90 p-6 text-center" data-test="play-error">
                <p>{{ error }}</p>
                <Link :href="`/crews/${crew}`" class="mt-4 inline-block underline">{{ t('session.back_to_lobby') }}</Link>
            </div>
        </div>
        <div v-else-if="!boot" class="flex h-full items-center justify-center">{{ t('training.loading') }}</div>
        <GameScreen
            v-else
            mode="mission"
            :station="seat"
            :difficulty="difficulty"
            :seed="boot.seed"
            :aircraft-config="boot.aircraft_config"
            :mission="boot.mission"
            :theatre="{ name: boot.theatre_name, placeholder: boot.theatre_placeholder, definition: boot.theatre }"
            :max-time-scale="boot.max_time_scale"
            :net="{ bootstrap: boot, humans, delayMs }"
            :graphics="graphics"
            :initial-zones="boot.airframe_zones ?? {}"
            :flight="flight"
            @finished="finished"
        />
    </div>
</template>
