<script setup lang="ts">
import { Head, Link } from '@inertiajs/vue3';
import { useI18n } from '@/composables/useI18n';
import { home } from '@/routes';

/** «О проекте» (раздел 13): атрибуции ассетов — из docs/assets.md, без копий в коде. */
defineProps<{ assets: { path: string; what: string; source: string; license: string; attribution: string }[] }>();

const { t } = useI18n();
</script>

<template>
    <Head :title="t('about.title')" />
    <div class="min-h-screen bg-stone-950 text-stone-100">
        <div class="mx-auto max-w-4xl space-y-6 p-6" data-test="about">
            <Link :href="home()" class="text-sm text-stone-400 underline">{{ t('about.back') }}</Link>
            <h1 class="text-3xl font-semibold">{{ t('about.title') }}</h1>
            <p class="text-stone-300">{{ t('about.intro') }}</p>
            <p class="text-sm text-amber-300">{{ t('about.placeholder_note') }}</p>
            <p class="text-sm text-stone-400">{{ t('about.nose_art') }}</p>

            <h2 class="pt-2 text-xl font-semibold">{{ t('about.assets') }}</h2>
            <table class="w-full text-left text-sm">
                <thead class="text-xs text-stone-400">
                    <tr>
                        <th class="py-1 pr-2">{{ t('about.asset') }}</th>
                        <th class="pr-2">{{ t('about.source') }}</th>
                        <th class="pr-2">{{ t('about.license') }}</th>
                        <th>{{ t('about.attribution') }}</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="a in assets" :key="a.path" class="border-t border-stone-800 align-top" data-test="about-asset">
                        <td class="py-1 pr-2">{{ a.what }}</td>
                        <td class="pr-2">{{ a.source }}</td>
                        <td class="pr-2">{{ a.license }}</td>
                        <td>{{ a.attribution }}</td>
                    </tr>
                </tbody>
            </table>
            <p class="text-xs text-stone-500">{{ t('about.libraries') }}</p>
        </div>
    </div>
</template>
