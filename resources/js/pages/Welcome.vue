<script setup lang="ts">
import { Head, Link } from '@inertiajs/vue3';
import { SkipForward, Volume2, VolumeX } from '@lucide/vue';
import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import { useI18n } from '@/composables/useI18n';
import type { MenuMusic, Track } from '@/game/menu/music';
import { dashboard, login, register } from '@/routes';
import { index as missions, solo } from '@/routes/missions';
import { show as training } from '@/routes/training';

const { t } = useI18n();

/**
 * Главное меню (раздел 12): за меню — вид от левой стороны начала полосы Алезани,
 * где взлетают и садятся самолёты. Музыка — только здесь; треки — файлы в resources/audio/menu/.
 */

const stations = ['pilot', 'copilot', 'bombardier', 'navigator', 'top_gunner', 'radio', 'waist_gunner', 'tail_gunner'] as const;

const background = ref<HTMLDivElement | null>(null);
const showTrainings = ref(false);
const music = shallowRef<MenuMusic | null>(null);
const track = ref<Track | null>(null);
const volume = ref(0.5);
const muted = ref(false);
let disposeScene: (() => void) | null = null;
let unsubscribe: (() => void) | null = null;

function webgl2Available(): boolean {
    try {
        return document.createElement('canvas').getContext('webgl2') !== null;
    } catch {
        return false;
    }
}

onMounted(async () => {
    const { MenuMusic } = await import('@/game/menu/music');
    const player = new MenuMusic();

    music.value = player;
    volume.value = player.volume;
    muted.value = player.muted;
    unsubscribe = player.onChange(() => {
        track.value = player.current;
        volume.value = player.volume;
        muted.value = player.muted;
    });

    // 3D-фон — отдельным чанком и только там, где есть WebGL2.
    if (background.value && webgl2Available()) {
        try {
            const [{ mountMenuScene }, { CORSICA_ALESAN }] = await Promise.all([import('@/game/menu/menuScene'), import('@/sim/core/terrain')]);

            if (background.value) {
                // Отладка сцены в разработке: ?debug_menu=takeoff | landing | formation | traffic.
                const debug = import.meta.env.DEV ? new URLSearchParams(window.location.search).get('debug_menu') : null;
                const only = debug === 'takeoff' || debug === 'landing' || debug === 'formation' || debug === 'traffic' ? debug : undefined;

                disposeScene = mountMenuScene(background.value, CORSICA_ALESAN, { only }).dispose;
            }
        } catch {
            // Без фона меню остаётся рабочим.
        }
    }
});

onBeforeUnmount(() => {
    unsubscribe?.();
    music.value?.dispose();
    disposeScene?.();
});
</script>

<template>
    <Head :title="t('app.title')" />

    <div class="relative h-screen w-screen overflow-hidden bg-gradient-to-b from-sky-300 to-stone-500 text-stone-100 select-none">
        <div ref="background" class="absolute inset-0" data-test="menu-scene" />
        <div class="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/70 via-black/25 to-transparent" />

        <main class="relative flex h-full max-w-xl flex-col justify-center gap-8 px-10 pb-10 sm:px-16">
            <div class="space-y-2 drop-shadow">
                <p class="text-xs tracking-[0.3em] text-stone-300 uppercase">B-25J · 43-4064 · 8U · 488th BS</p>
                <h1 class="text-4xl font-semibold sm:text-5xl">{{ t('app.title') }}</h1>
                <p class="text-lg text-stone-200">{{ t('app.subtitle') }}</p>
                <p class="text-sm text-stone-300">{{ t('home.tagline') }}</p>
            </div>

            <nav class="flex w-72 flex-col gap-2 text-base" data-test="main-menu">
                <template v-if="$page.props.auth.user">
                    <Link :href="solo('milk-run')" class="menu-item bg-amber-600/90 hover:bg-amber-500" data-test="menu-quick-start">{{ t('home.quick_start') }}</Link>
                    <Link :href="missions()" class="menu-item" data-test="menu-missions">{{ t('menu.missions') }}</Link>
                    <button type="button" class="menu-item text-left" data-test="menu-trainings" :aria-expanded="showTrainings" @click="showTrainings = !showTrainings">
                        {{ t('home.training') }} {{ showTrainings ? '▴' : '▾' }}
                    </button>
                    <div v-if="showTrainings" class="grid grid-cols-2 gap-1 pl-2 text-sm">
                        <Link v-for="(s, i) in stations" :key="s" :href="training(s)" class="rounded bg-black/45 px-2 py-1 hover:bg-black/70" :data-test="`menu-training-${s}`">
                            {{ i + 1 }}. {{ t(`station.${s}`) }}
                        </Link>
                    </div>
                    <Link :href="dashboard()" class="menu-item" data-test="home-dashboard">{{ t('home.dashboard') }}</Link>
                </template>
                <template v-else>
                    <Link :href="login()" class="menu-item bg-amber-600/90 hover:bg-amber-500" data-test="menu-login">{{ t('home.login') }}</Link>
                    <Link :href="register()" class="menu-item" data-test="menu-register">{{ t('home.register') }}</Link>
                </template>
            </nav>

            <p class="max-w-md text-xs text-stone-300">{{ t('home.stage_notice') }}</p>
            <Link href="/about" class="text-xs text-stone-400 underline" data-test="menu-about">{{ t('about.title') }}</Link>
        </main>

        <!-- Музыка: только если в resources/audio/menu/ есть треки. -->
        <div v-if="music && music.tracks.length > 0" class="absolute right-4 bottom-4 flex items-center gap-2 rounded-md bg-black/55 px-3 py-2 text-xs" data-test="menu-music">
            <button type="button" class="rounded bg-stone-700 px-2 py-0.5" :aria-pressed="!muted" :aria-label="t('menu.mute')" :title="t('menu.mute')" @click="music.toggleMute()">
                <VolumeX v-if="muted" class="size-4" aria-hidden="true" />
                <Volume2 v-else class="size-4" aria-hidden="true" />
            </button>
            <input type="range" min="0" max="1" step="0.05" class="w-24" :value="volume" :aria-label="t('menu.volume')" @input="music.setVolume(Number(($event.target as HTMLInputElement).value))" />
            <button type="button" class="rounded bg-stone-700 px-2 py-0.5" :title="t('menu.next_track')" :aria-label="t('menu.next_track')" @click="music.next()"><SkipForward class="size-4" aria-hidden="true" /></button>
            <span class="max-w-48 truncate text-stone-300">{{ track ? track.title : t('menu.music_click') }}</span>
        </div>
    </div>
</template>

<style scoped>
@reference '../../css/app.css';

.menu-item {
    @apply rounded-md bg-black/50 px-4 py-2 font-medium backdrop-blur-sm transition hover:bg-black/75;
}
</style>
