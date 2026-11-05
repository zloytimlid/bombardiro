<script setup lang="ts">
import { Head, Link } from '@inertiajs/vue3';
import { useI18n } from '@/composables/useI18n';
import { solo } from '@/routes/missions';

/** Каталог миссий (раздел 11: GET /missions). */
defineProps<{
    missions: { slug: string; title: { ru: string; en: string }; difficulty: string; placeholder: boolean; historical_date: string | null; version: number; summary: { ru: string; en: string } }[];
}>();

const { t, locale } = useI18n();
</script>

<template>
    <Head :title="t('missions.title')" />
    <div class="space-y-4 p-6">
            <h1 class="text-2xl font-semibold">{{ t('missions.title') }}</h1>
            <div class="grid gap-4 md:grid-cols-2">
                <div v-for="m in missions" :key="m.slug" class="space-y-2 rounded-lg border p-4" :data-test="`mission-${m.slug}`">
                    <div class="flex items-center justify-between">
                        <h2 class="text-lg font-semibold">{{ m.title[locale] }}</h2>
                        <span class="text-xs text-muted-foreground">{{ t(`mission_difficulty.${m.difficulty}`) }} · v{{ m.version }}</span>
                    </div>
                    <p class="text-sm text-muted-foreground">{{ m.summary[locale] }}</p>
                    <p v-if="m.placeholder" class="text-xs text-amber-600">{{ t('briefing.placeholder') }}</p>
                    <Link :href="solo(m.slug)" class="inline-block rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground" :data-test="`fly-${m.slug}`">{{ t('missions.fly_solo') }}</Link>
                </div>
            </div>
        </div>
</template>
