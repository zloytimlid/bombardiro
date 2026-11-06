<script setup lang="ts">
import { Head, Link } from '@inertiajs/vue3';
import { Clock, Crosshair, Map, Medal, Mountain, Plane, Shield, Star, Target, Users, Wrench } from '@lucide/vue';
import type { Component } from 'vue';
import { computed } from 'vue';
import { useI18n } from '@/composables/useI18n';

/** Ангар (раздел 12): профиль пилота, статистика, достижения, история вылетов борта. */
const props = defineProps<{
    profile: { callsign: string; rank: string; missions_total: number; flight_hours: number; preferred_seat: string | null } | null;
    achievements: { slug: string; icon: string; title: Record<string, string>; description: Record<string, string>; unlocked_at: string | null }[];
    history: { session: string; mission: Record<string, string>; seat: string; status: string; outcome: string | null; score: number | null; verified: boolean; date: string | null }[];
}>();

const { t, locale } = useI18n();
const unlocked = computed(() => props.achievements.filter((a) => a.unlocked_at !== null).length);
const ICONS: Record<string, Component> = { plane: Plane, target: Target, clock: Clock, map: Map, mountain: Mountain, users: Users, shield: Shield, wrench: Wrench, crosshair: Crosshair, medal: Medal };
</script>

<template>
    <Head :title="t('hangar.title')" />
    <div class="mx-auto max-w-5xl space-y-6 p-6" data-test="hangar">
        <h1 class="text-2xl font-semibold">{{ t('hangar.title') }}</h1>

        <section v-if="profile" class="grid gap-3 rounded-lg border p-4 sm:grid-cols-4" data-test="hangar-profile">
            <div>
                <div class="text-xs text-muted-foreground">{{ t('hangar.callsign') }}</div>
                <div class="text-lg font-semibold">{{ profile.callsign }}</div>
            </div>
            <div>
                <div class="text-xs text-muted-foreground">{{ t('hangar.rank') }}</div>
                <div>{{ t(`rank.${profile.rank}`) }}</div>
            </div>
            <div>
                <div class="text-xs text-muted-foreground">{{ t('hangar.sorties') }}</div>
                <div class="font-mono text-lg" data-test="hangar-sorties">{{ profile.missions_total }}</div>
            </div>
            <div>
                <div class="text-xs text-muted-foreground">{{ t('hangar.hours') }}</div>
                <div class="font-mono text-lg">{{ profile.flight_hours }}</div>
            </div>
        </section>

        <section class="space-y-2">
            <h2 class="text-lg font-semibold">{{ t('hangar.achievements', { n: unlocked, total: achievements.length }) }}</h2>
            <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                <div
                    v-for="a in achievements"
                    :key="a.slug"
                    class="flex gap-3 rounded-lg border p-3"
                    :class="a.unlocked_at ? '' : 'opacity-50'"
                    :data-test="`achievement-${a.slug}`"
                    :data-unlocked="a.unlocked_at !== null"
                >
                    <component :is="ICONS[a.icon] ?? Star" class="size-7 shrink-0" aria-hidden="true" />
                    <div>
                        <div class="font-semibold">{{ a.title[locale] ?? a.slug }}</div>
                        <div class="text-xs text-muted-foreground">{{ a.description[locale] }}</div>
                        <div class="mt-1 text-xs">{{ a.unlocked_at ? t('hangar.unlocked', { date: a.unlocked_at.slice(0, 10) }) : t('hangar.locked') }}</div>
                    </div>
                </div>
            </div>
        </section>

        <section class="space-y-2">
            <div class="flex items-center justify-between">
                <h2 class="text-lg font-semibold">{{ t('hangar.history') }}</h2>
                <Link href="/leaderboards" class="text-sm underline">{{ t('leaderboards.title') }}</Link>
            </div>
            <p v-if="history.length === 0" class="text-sm text-muted-foreground">{{ t('hangar.no_history') }}</p>
            <table v-else class="w-full text-sm">
                <thead class="text-left text-xs text-muted-foreground">
                    <tr>
                        <th class="py-1">{{ t('hangar.date') }}</th>
                        <th>{{ t('hangar.mission') }}</th>
                        <th>{{ t('hangar.seat') }}</th>
                        <th>{{ t('hangar.outcome') }}</th>
                        <th class="text-right">{{ t('hangar.score') }}</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="h in history" :key="h.session" class="border-t">
                        <td class="py-1 font-mono">{{ h.date ?? '—' }}</td>
                        <td>
                            <Link :href="`/debrief/${h.session}`" class="underline">{{ h.mission[locale] ?? '—' }}</Link>
                        </td>
                        <td>{{ t(`station.${h.seat}`) }}</td>
                        <td>{{ h.outcome ? t(`outcome.${h.outcome}`) : t(`session.status.${h.status}`) }}</td>
                        <td class="text-right font-mono">
                            {{ h.score ?? '—' }}
                            <span v-if="h.score !== null && !h.verified" :title="t('session.unverified')">*</span>
                        </td>
                    </tr>
                </tbody>
            </table>
        </section>
    </div>
</template>
