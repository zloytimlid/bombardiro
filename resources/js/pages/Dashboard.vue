<script setup lang="ts">
import { Head, Link } from '@inertiajs/vue3';
import { useI18n } from '@/composables/useI18n';
import { dashboard } from '@/routes';
import { realtime } from '@/routes/diagnostics';

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
        breadcrumbs: [{ title: 'Dashboard', href: dashboard() }],
    },
});

const { t } = useI18n();
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

        <Link
            :href="realtime()"
            class="self-start rounded-md border px-4 py-2 text-sm hover:bg-muted"
        >
            {{ t('dashboard.realtime_check') }}
        </Link>
    </div>
</template>
