<script setup lang="ts">
import { useI18n } from '@/composables/useI18n';
import { Head } from '@inertiajs/vue3';
import AppearanceTabs from '@/components/AppearanceTabs.vue';
import Heading from '@/components/Heading.vue';
import { edit } from '@/routes/appearance';

const { t } = useI18n();

defineOptions({
    layout: {
        breadcrumbs: [
            {
                title: 'ui.appearance_settings',
                href: edit(),
            },
        ],
    },
});
</script>

<template>
    <Head :title="t('ui.appearance_settings')" />

    <h1 class="sr-only">{{ t('ui.appearance_settings') }}</h1>

    <div class="space-y-6">
        <Heading
            variant="small"
            :title="t('ui.appearance_settings')"
            :description="t('ui.appearance_description')"
        />
        <AppearanceTabs />
    </div>
</template>
