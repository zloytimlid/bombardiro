<script setup lang="ts">
import { Head, Link, router } from '@inertiajs/vue3';
import { computed, ref } from 'vue';
import { useI18n } from '@/composables/useI18n';
import { api, ApiError } from '@/game/net/api';
import { solo } from '@/routes/missions';

/** Каталог миссий (раздел 11: GET /missions): одиночный вылет, экипаж, вход по коду. */
const props = defineProps<{
    missions: { slug: string; title: { ru: string; en: string }; difficulty: string; placeholder: boolean; historical_date: string | null; version: number; summary: { ru: string; en: string } }[];
    /** Генератор (этап 6): грузится по запросу формы (Inertia optional). */
    generator?: { theatre: Record<string, unknown> & { generator?: { targets: { id: string; name: { ru: string; en: string } }[] } }; base: Record<string, unknown> } | null;
}>();

const { t, locale } = useI18n();
const code = ref('');
const error = ref<string | null>(null);
const busy = ref(false);

async function go(request: () => Promise<{ data: { ulid: string } }>): Promise<void> {
    error.value = null;
    busy.value = true;

    try {
        const res = await request();

        router.visit(`/crews/${res.data.ulid}`);
    } catch (e) {
        error.value = e instanceof ApiError ? e.message : String(e);
    } finally {
        busy.value = false;
    }
}

const flyAsCrew = (slug: string): Promise<void> => go(() => api('POST', '/api/crews', { mission: slug, visibility: 'private', max_players: 8 }));
const join = (): Promise<void> => go(() => api('POST', '/api/crews/join', { invite_code: code.value.trim().toUpperCase() }));

// ── Генератор вылетов (раздел 8.5, этап 6): сборка в браузере тем же симядром, сервер проверяет схемой.
const genOpen = ref(false);
const genTarget = ref('');
const genMonth = ref(8);
const genDifficulty = ref<'training' | 'normal' | 'hard'>('normal');
const genSeed = ref(newSeed());
const genTargets = computed(() => props.generator?.theatre.generator?.targets ?? []);

function newSeed(): number {
    // Сид интерфейса — не симядро: криптослучайность браузера (Math.random в ядре запрещён).
    return (crypto.getRandomValues(new Uint32Array(1))[0] % 2_147_483_646) + 1;
}

function openGenerator(): void {
    genOpen.value = !genOpen.value;

    if (genOpen.value && props.generator === undefined) {
        router.reload({ only: ['generator'] });
    }
}

function generate(): Promise<void> {
    return go(async () => {
        const source = props.generator;

        if (!source) {
            throw new Error(t('generator.unavailable'));
        }

        const [{ generateMission }, { parseTheatre }, { parseMission }] = await Promise.all([
            import('@/sim/core/mission/generator'),
            import('@/sim/core/terrain'),
            import('@/sim/core/mission/schema'),
        ]);
        const pool = (source.theatre as { generator: { targets: never[]; flak_zones: never[] } }).generator;
        const definition = generateMission(parseTheatre(source.theatre), parseMission(source.base), {
            seed: genSeed.value,
            difficulty: genDifficulty.value,
            month: genMonth.value,
            targets: pool.targets,
            flakZones: pool.flak_zones,
            targetId: genTarget.value === '' ? undefined : genTarget.value,
        });
        const created = await api<{ data: { slug: string } }>('POST', '/api/missions/generated', { definition });

        return api<{ data: { ulid: string } }>('POST', '/api/crews', { mission: created.data.slug, visibility: 'private', max_players: 8 });
    });
}
</script>

<template>
    <Head :title="t('missions.title')" />
    <div class="space-y-4 p-6">
        <div class="flex flex-wrap items-center justify-between gap-3">
            <h1 class="text-2xl font-semibold">{{ t('missions.title') }}</h1>
            <form class="flex items-center gap-2" @submit.prevent="join">
                <input
                    v-model="code"
                    maxlength="8"
                    class="w-36 rounded border bg-background px-2 py-1.5 font-mono tracking-widest uppercase"
                    :placeholder="t('lobby.invite_code')"
                    data-test="join-code"
                />
                <button class="rounded border px-3 py-1.5 text-sm" :disabled="busy || code.trim().length !== 8" data-test="join">{{ t('lobby.join') }}</button>
            </form>
        </div>
        <p v-if="error" class="rounded bg-red-100 p-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200" data-test="missions-error">{{ error }}</p>
        <section class="space-y-3 rounded-lg border p-4" data-test="generator">
            <button class="text-lg font-semibold" data-test="generator-toggle" @click="openGenerator">{{ t('generator.title') }}</button>
            <form v-if="genOpen" class="flex flex-wrap items-end gap-3 text-sm" @submit.prevent="generate">
                <label class="flex flex-col gap-1">
                    <span>{{ t('generator.target') }}</span>
                    <select v-model="genTarget" class="rounded border bg-background px-2 py-1" data-test="generator-target">
                        <option value="">{{ t('generator.random') }}</option>
                        <option v-for="tg in genTargets" :key="tg.id" :value="tg.id">{{ tg.name[locale] }}</option>
                    </select>
                </label>
                <label class="flex flex-col gap-1">
                    <span>{{ t('generator.month') }}</span>
                    <input v-model.number="genMonth" type="number" min="1" max="12" class="w-20 rounded border bg-background px-2 py-1" data-test="generator-month" />
                </label>
                <label class="flex flex-col gap-1">
                    <span>{{ t('generator.difficulty') }}</span>
                    <select v-model="genDifficulty" class="rounded border bg-background px-2 py-1" data-test="generator-difficulty">
                        <option value="training">{{ t('mission_difficulty.training') }}</option>
                        <option value="normal">{{ t('mission_difficulty.normal') }}</option>
                        <option value="hard">{{ t('mission_difficulty.hard') }}</option>
                    </select>
                </label>
                <label class="flex flex-col gap-1">
                    <span>{{ t('generator.seed') }}</span>
                    <input v-model.number="genSeed" type="number" min="1" class="w-36 rounded border bg-background px-2 py-1 font-mono" data-test="generator-seed" />
                </label>
                <button class="rounded bg-primary px-3 py-1.5 text-primary-foreground" :disabled="busy || !generator" data-test="generator-go">{{ t('generator.go') }}</button>
            </form>
            <p v-if="genOpen" class="text-xs text-muted-foreground">{{ t('generator.note') }}</p>
        </section>
        <div class="grid gap-4 md:grid-cols-2">
            <div v-for="m in missions" :key="m.slug" class="space-y-2 rounded-lg border p-4" :data-test="`mission-${m.slug}`">
                <div class="flex items-center justify-between">
                    <h2 class="text-lg font-semibold">{{ m.title[locale] }}</h2>
                    <span class="text-xs text-muted-foreground">{{ t(`mission_difficulty.${m.difficulty}`) }} · v{{ m.version }}</span>
                </div>
                <p class="text-sm text-muted-foreground">{{ m.summary[locale] }}</p>
                <p v-if="m.placeholder" class="text-xs text-amber-600">{{ t('briefing.placeholder') }}</p>
                <div class="flex flex-wrap gap-2">
                    <Link :href="solo(m.slug)" class="inline-block rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground" :data-test="`fly-${m.slug}`">{{ t('missions.fly_solo') }}</Link>
                    <button class="rounded border px-3 py-1.5 text-sm" :disabled="busy" :data-test="`crew-${m.slug}`" @click="flyAsCrew(m.slug)">{{ t('missions.fly_crew') }}</button>
                </div>
            </div>
        </div>
    </div>
</template>
