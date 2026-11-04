<script setup lang="ts">
import { Head, Link } from '@inertiajs/vue3';
import { useI18n } from '@/composables/useI18n';
import { dashboard, login, register } from '@/routes';

const { t } = useI18n();

const stations = [
    'pilot',
    'copilot',
    'bombardier',
    'navigator',
    'top_gunner',
    'radio',
    'waist_gunner',
    'tail_gunner',
] as const;
</script>

<template>
    <Head :title="t('app.title')" />

    <div
        class="flex min-h-screen flex-col bg-stone-100 text-stone-900 dark:bg-stone-950 dark:text-stone-100"
    >
        <header class="flex items-center justify-end gap-3 p-6">
            <Link
                v-if="$page.props.auth.user"
                :href="dashboard()"
                class="rounded-sm border border-stone-400 px-5 py-1.5 text-sm hover:border-stone-600"
                data-test="home-dashboard"
            >
                {{ t('home.dashboard') }}
            </Link>
            <template v-else>
                <Link
                    :href="login()"
                    class="rounded-sm px-5 py-1.5 text-sm hover:underline"
                >
                    {{ t('home.login') }}
                </Link>
                <Link
                    :href="register()"
                    class="rounded-sm border border-stone-400 px-5 py-1.5 text-sm hover:border-stone-600"
                >
                    {{ t('home.register') }}
                </Link>
            </template>
        </header>

        <main
            class="mx-auto flex w-full max-w-4xl flex-1 flex-col justify-center gap-8 px-6 pb-16"
        >
            <div class="flex flex-col gap-3">
                <p
                    class="text-xs tracking-[0.3em] text-stone-500 uppercase"
                >
                    B-25J · 43-4064 · 8U
                </p>
                <h1 class="text-4xl font-semibold sm:text-5xl">
                    {{ t('app.title') }}
                </h1>
                <p class="text-lg text-stone-600 dark:text-stone-400">
                    {{ t('app.subtitle') }}
                </p>
                <p class="max-w-2xl text-stone-600 dark:text-stone-400">
                    {{ t('home.tagline') }}
                </p>
            </div>

            <ol class="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <li
                    v-for="(station, index) in stations"
                    :key="station"
                    class="flex items-center gap-3 rounded-md border border-stone-300 bg-white/60 px-3 py-2 text-sm dark:border-stone-800 dark:bg-stone-900/60"
                >
                    <kbd
                        class="flex size-6 items-center justify-center rounded border border-stone-400 font-mono text-xs"
                        >{{ index + 1 }}</kbd
                    >
                    {{ t(`station.${station}`) }}
                </li>
            </ol>

            <p
                class="rounded-md border border-amber-500/40 bg-amber-100/50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200"
            >
                {{ t('home.stage_notice') }}
            </p>
        </main>
    </div>
</template>
