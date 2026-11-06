<script setup lang="ts">
import { Head, router } from '@inertiajs/vue3';
import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import DebriefView from '@/components/game/DebriefView.vue';
import { useI18n } from '@/composables/useI18n';
import { api } from '@/game/net/api';
import type { Debrief, Station } from '@/sim/core';

const { t } = useI18n();

/**
 * Серверный разбор кооперативного вылета (раздел 9.4): сервер пересчитал цель, время над целью
 * и итог по журналу; одинаков у всех участников. Пока задача считает — опрос раз в 2 с.
 */
const props = defineProps<{ session: string; crew: string }>();

type DebriefResponse = { ready: boolean; data: (Debrief & { verified: boolean; flags: string[] }) | null; seat: string | null };

const debrief = shallowRef<DebriefResponse['data']>(null);
const seat = ref<Station>('pilot');
const failed = ref(false);
let timer: number | null = null;
let attempts = 0;

async function poll(): Promise<void> {
    try {
        const res = await api<DebriefResponse>('GET', `/api/sessions/${props.session}/debrief`);

        seat.value = (res.seat as Station | null) ?? 'pilot';

        if (res.ready && res.data) {
            debrief.value = res.data;

            return;
        }
    } catch {
        // Повторим.
    }

    // ~2 минуты ожидания — дальше показать ошибку (вылет без итога, например хост пропал навсегда).
    if (++attempts > 60) {
        failed.value = true;

        return;
    }

    timer = window.setTimeout(() => void poll(), 2000);
}

// Повтор (этап 6): собирается задачей после разбора; закрепить может хост или владелец экипажа.
const pinned = ref<boolean | null>(null);
const replayError = ref(false);

async function togglePin(): Promise<void> {
    replayError.value = false;

    try {
        const res = await api<{ pinned: boolean }>('POST', `/api/sessions/${props.session}/replay/pin`);

        pinned.value = res.pinned;
    } catch {
        replayError.value = true;
    }
}

onMounted(() => void poll());
onBeforeUnmount(() => {
    if (timer !== null) {
        window.clearTimeout(timer);
    }
});
</script>

<template>
    <Head :title="t('debrief.title')" />
    <div class="relative min-h-screen w-full bg-black text-stone-100" data-test="server-debrief" :data-ready="debrief !== null">
        <template v-if="debrief">
            <div v-if="!debrief.verified" class="absolute top-2 left-1/2 z-10 -translate-x-1/2 rounded bg-amber-800 px-3 py-1 text-xs" data-test="unverified">
                {{ t('session.unverified') }}
            </div>
            <DebriefView :debrief="debrief" :you="seat" @again="router.visit(`/crews/${crew}`)" @exit="router.visit('/dashboard')" />
            <div class="absolute right-2 bottom-2 z-10 flex items-center gap-2 text-xs" data-test="replay">
                <a :href="`/api/sessions/${session}/replay`" class="rounded border border-stone-500 px-2 py-1 hover:bg-stone-800" data-test="replay-download" download>{{ t('replay.download') }}</a>
                <button class="rounded border border-stone-500 px-2 py-1 hover:bg-stone-800" data-test="replay-pin" @click="togglePin">{{ pinned ? t('replay.unpin') : t('replay.pin') }}</button>
                <span v-if="replayError" class="text-amber-400" data-test="replay-error">{{ t('replay.unavailable') }}</span>
            </div>
        </template>
        <div v-else class="flex h-screen items-center justify-center text-lg" data-test="debrief-pending">
            {{ failed ? t('session.debrief_failed') : t('session.debrief_pending') }}
        </div>
    </div>
</template>
