<script setup lang="ts">
import { Head } from '@inertiajs/vue3';
import { onMounted, ref, watch } from 'vue';
import { useI18n } from '@/composables/useI18n';
import { api } from '@/game/net/api';

/** Рейтинги (раздел 11: GET /api/leaderboards): лучшие проверенные вылеты по миссии и периоду. */
const props = defineProps<{ missions: { slug: string; title: Record<string, string> }[] }>();
const { t, locale } = useI18n();

type Row = { rank: number; session: string; crew: string; score: number; outcome: string | null; difficulty: string; date: string | null; players: string[] };

const mission = ref(props.missions[0]?.slug ?? '');
const period = ref<'week' | 'month' | 'all'>('all');
const rows = ref<Row[]>([]);
const loading = ref(false);

async function load(): Promise<void> {
    if (mission.value === '') {
        return;
    }

    loading.value = true;

    try {
        const res = await api<{ data: Row[] }>('GET', `/api/leaderboards?mission=${encodeURIComponent(mission.value)}&period=${period.value}`);

        rows.value = res.data;
    } finally {
        loading.value = false;
    }
}

onMounted(() => void load());
watch([mission, period], () => void load());
</script>

<template>
    <Head :title="t('leaderboards.title')" />
    <div class="mx-auto max-w-4xl space-y-4 p-6" data-test="leaderboards">
        <h1 class="text-2xl font-semibold">{{ t('leaderboards.title') }}</h1>
        <div class="flex flex-wrap gap-2">
            <button
                v-for="m in missions"
                :key="m.slug"
                class="rounded border px-3 py-1 text-sm"
                :class="mission === m.slug ? 'bg-primary text-primary-foreground' : ''"
                :data-test="`lb-mission-${m.slug}`"
                @click="mission = m.slug"
            >
                {{ m.title[locale] ?? m.slug }}
            </button>
            <select v-model="period" class="ml-auto rounded border bg-background px-2 py-1 text-sm" data-test="lb-period">
                <option value="week">{{ t('leaderboards.week') }}</option>
                <option value="month">{{ t('leaderboards.month') }}</option>
                <option value="all">{{ t('leaderboards.all') }}</option>
            </select>
        </div>
        <p class="text-xs text-muted-foreground">{{ t('leaderboards.note') }}</p>
        <p v-if="!loading && rows.length === 0" class="text-sm text-muted-foreground" data-test="lb-empty">{{ t('leaderboards.empty') }}</p>
        <table v-else class="w-full text-sm">
            <thead class="text-left text-xs text-muted-foreground">
                <tr>
                    <th class="py-1">#</th>
                    <th>{{ t('leaderboards.crew') }}</th>
                    <th>{{ t('leaderboards.players') }}</th>
                    <th>{{ t('hangar.outcome') }}</th>
                    <th>{{ t('hangar.date') }}</th>
                    <th class="text-right">{{ t('hangar.score') }}</th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="r in rows" :key="r.session" class="border-t" data-test="lb-row">
                    <td class="py-1 font-mono">{{ r.rank }}</td>
                    <td>{{ r.crew }}</td>
                    <td>{{ r.players.join(', ') }}</td>
                    <td>{{ r.outcome ? t(`outcome.${r.outcome}`) : '—' }} · {{ t(`difficulty.${r.difficulty}`) }}</td>
                    <td class="font-mono">{{ r.date ?? '—' }}</td>
                    <td class="text-right font-mono font-semibold">{{ r.score }}</td>
                </tr>
            </tbody>
        </table>
    </div>
</template>
