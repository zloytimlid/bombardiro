<script setup lang="ts">
import { Head, Link } from '@inertiajs/vue3';
import { useI18n } from '@/composables/useI18n';
import { dashboard } from '@/routes';
import { realtime } from '@/routes/diagnostics';
import { index as missions, solo } from '@/routes/missions';
import { show as training } from '@/routes/training';

const { t } = useI18n();

type PilotProfile = {
    callsign: string;
    rank: string;
    missionsTotal: number;
    flightSecondsTotal: number;
};

defineProps<{
    profile: PilotProfile | null;
}>();

defineOptions({
    layout: {
        breadcrumbs: [{ title: 'appnav.dashboard', href: dashboard() }],
    },
});

// Порядок станций = клавиши 1–8 (App\Domain\Aircraft\Enums\Station); без импорта симядра в главный бандл.
const STATIONS = ['pilot', 'copilot', 'bombardier', 'navigator', 'top_gunner', 'radio', 'waist_gunner', 'tail_gunner'] as const;
</script>

<template>
    <Head :title="t('dashboard.title')" />

    <div class="flex h-full flex-1 flex-col gap-4 p-4">
        <section
            v-if="profile"
            class="flex flex-col gap-1 rounded-xl border border-sidebar-border/70 p-6 dark:border-sidebar-border"
            data-test="pilot-profile"
        >
            <h2 class="text-2xl font-semibold">
                {{ t('dashboard.callsign', { callsign: profile.callsign }) }}
            </h2>
            <p class="text-muted-foreground">
                {{ t('dashboard.missions_total', { count: profile.missionsTotal }) }}
            </p>
        </section>

        <section class="space-y-2">
            <h3 class="font-semibold">{{ t('dashboard.sortie') }}</h3>
            <div class="flex flex-wrap gap-2">
                <Link :href="missions()" class="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90" data-test="missions-link">
                    {{ t('dashboard.missions') }}
                </Link>
                <Link :href="solo('milk-run')" class="rounded-md border px-4 py-2 text-sm hover:bg-muted" data-test="milk-run-link">
                    {{ t('dashboard.milk_run') }}
                </Link>
            </div>
        </section>

        <section class="space-y-2">
            <h3 class="font-semibold">{{ t('home.training') }}</h3>
            <div class="flex flex-wrap gap-2">
                <Link
                    v-for="(s, i) in STATIONS"
                    :key="s"
                    :href="training(s)"
                    class="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
                    :data-test="`training-${s}`"
                >
                    {{ i + 1 }}. {{ t(`station.${s}`) }}
                </Link>
            </div>
        </section>

        <Link
            :href="realtime()"
            class="self-start rounded-md border px-4 py-2 text-sm hover:bg-muted"
        >
            {{ t('dashboard.realtime_check') }}
        </Link>
    </div>
</template>
