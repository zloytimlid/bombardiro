<script setup lang="ts">
import { Head, Link } from '@inertiajs/vue3';
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from '@/composables/useI18n';
import type { GameHandle, GameStatus } from '@/game/boot';
import { dashboard } from '@/routes';

const props = defineProps<{
    station: string;
    available: boolean;
    difficulty: 'training' | 'historical';
    seed: number;
    aircraftConfig: Record<string, unknown>;
    theatre: { name: string; placeholder: boolean; definition: Record<string, unknown> };
}>();

const { t } = useI18n();
const container = ref<HTMLDivElement | null>(null);
const status = ref<GameStatus | null>(null);
const error = ref<string | null>(null);
const loading = ref(true);
const autopilot = ref(false);
const showHelp = ref(true);
let game: GameHandle | null = null;

const unsupported = typeof window !== 'undefined' && (window.matchMedia('(pointer: coarse)').matches && window.innerWidth < 1024);

function webgl2Available(): boolean {
    try {
        return document.createElement('canvas').getContext('webgl2') !== null;
    } catch {
        return false;
    }
}

onMounted(async () => {
    if (!props.available || unsupported) {
        loading.value = false;

        return;
    }

    if (!webgl2Available()) {
        error.value = t('training.no_webgl2');
        loading.value = false;

        return;
    }

    try {
        // Игровой бандл — отдельный чанк (раздел 4).
        const { mountGame } = await import('@/game/boot');
        const { parseTheatre } = await import('@/sim/core');

        if (container.value) {
            game = await mountGame(container.value, {
                config: props.aircraftConfig,
                theatre: parseTheatre(props.theatre.definition),
                difficulty: props.difficulty,
                seed: props.seed,
                onStatus: (s) => (status.value = s),
            });
        }
    } catch (e) {
        error.value = e instanceof Error ? e.message : String(e);
    } finally {
        loading.value = false;
    }
});

onBeforeUnmount(() => game?.dispose());

async function toggleAutopilot(): Promise<void> {
    autopilot.value = !autopilot.value;
    await game?.setAutopilot(autopilot.value);
}

async function restart(): Promise<void> {
    autopilot.value = false;
    await game?.setAutopilot(false);
    await game?.restart();
}

const fmt = (v: number, digits = 0) => v.toFixed(digits);
</script>

<template>
    <Head :title="t(`station.${station}`)" />

    <div class="relative h-screen w-screen overflow-hidden bg-black text-stone-100 select-none">
        <div ref="container" class="absolute inset-0" data-test="game-canvas" />

        <div v-if="!available || unsupported || error" class="absolute inset-0 flex items-center justify-center p-6">
            <div class="max-w-md rounded-lg border border-stone-700 bg-stone-900/90 p-6 text-center">
                <p v-if="unsupported">{{ t('training.unsupported_device') }}</p>
                <p v-else-if="error">{{ error }}</p>
                <p v-else>{{ t('training.not_yet', { station: t(`station.${station}`) }) }}</p>
                <Link :href="dashboard()" class="mt-4 inline-block underline">{{ t('training.back') }}</Link>
            </div>
        </div>

        <div v-else-if="loading" class="absolute inset-0 flex items-center justify-center">
            {{ t('training.loading') }}
        </div>

        <template v-if="status">
            <!-- Полоса статуса: дубли приборов для «Учебного» режима. -->
            <div
                v-if="difficulty === 'training'"
                class="pointer-events-none absolute top-3 left-3 flex flex-wrap gap-x-4 gap-y-1 rounded-md bg-black/55 px-4 py-2 font-mono text-sm whitespace-nowrap"
                style="max-width: calc(100vw - 40rem)"
                data-test="flight-status"
                :data-contact="status.contact"
            >
                <span>{{ t('training.ias') }} {{ fmt(status.iasMph) }} mph</span>
                <span>{{ t('training.alt') }} {{ fmt(status.altitudeFt) }} ft</span>
                <span>{{ t('training.vs') }} {{ fmt(status.verticalSpeedFpm) }} ft/min</span>
                <span>{{ t('training.hdg') }} {{ fmt(status.headingDeg).padStart(3, '0') }}°</span>
                <span>{{ t('training.throttle') }} {{ fmt(status.throttle * 100) }}%</span>
                <span>{{ status.gearDown ? t('training.gear_down') : t('training.gear_up') }}</span>
                <span>{{ t('training.flaps') }} {{ fmt(status.flaps * 100) }}%</span>
            </div>

            <div class="absolute top-3 right-3 flex gap-2 text-sm">
                <button class="rounded bg-black/60 px-3 py-1.5 hover:bg-black/80" data-test="toggle-help" @click="showHelp = !showHelp">
                    {{ t('training.help') }}
                </button>
                <button v-if="difficulty === 'training'" class="rounded bg-black/60 px-3 py-1.5 hover:bg-black/80" @click="game?.toggleView()">
                    {{ t('training.view') }}
                </button>
                <button class="rounded bg-black/60 px-3 py-1.5 hover:bg-black/80" data-test="toggle-autopilot" :aria-pressed="autopilot" @click="toggleAutopilot">
                    {{ autopilot ? t('training.autopilot_off') : t('training.autopilot_on') }}
                </button>
                <button class="rounded bg-black/60 px-3 py-1.5 hover:bg-black/80" @click="restart">{{ t('training.restart') }}</button>
                <Link :href="dashboard()" class="rounded bg-black/60 px-3 py-1.5 hover:bg-black/80">{{ t('training.exit') }}</Link>
            </div>

            <div
                v-if="showHelp"
                class="absolute bottom-3 left-3 max-w-sm rounded-md bg-black/60 p-3 text-xs leading-relaxed"
                data-test="help"
            >
                <p class="mb-1 font-semibold">{{ t('training.help_title') }}</p>
                <p>{{ t('training.keys_flight') }}</p>
                <p>{{ t('training.keys_engines') }}</p>
                <p>{{ t('training.keys_config') }}</p>
                <p>{{ t('training.keys_view') }}</p>
                <p v-if="theatre.placeholder" class="mt-2 text-amber-300">{{ t('training.placeholder_theatre', { name: theatre.name }) }}</p>
            </div>

            <div class="pointer-events-none absolute right-3 bottom-3 rounded bg-black/50 px-2 py-1 font-mono text-xs" data-test="fps">
                {{ fmt(status.fps) }} FPS<span v-if="status.autopilotPhase"> · {{ t(`circuit.${status.autopilotPhase}`) }}</span>
                <span v-if="status.touchdownVsMs !== null && status.contact !== 'air'"> · {{ t('training.touchdown', { vs: fmt(status.touchdownVsMs, 2) }) }}</span>
            </div>

            <div v-if="status.paused" class="absolute inset-0 flex items-center justify-center bg-black/40 text-2xl">{{ t('training.paused') }}</div>
            <div v-if="status.contact === 'crashed'" class="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/50 text-2xl">
                {{ t('training.crashed') }}
                <button class="rounded bg-stone-100 px-4 py-2 text-base text-stone-900" @click="restart">{{ t('training.restart') }}</button>
            </div>
        </template>
    </div>
</template>
