<script setup lang="ts">
import { Link, usePage } from '@inertiajs/vue3';
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import BombardierPanel from '@/components/game/BombardierPanel.vue';
import CopilotPanel from '@/components/game/CopilotPanel.vue';
import DebriefView from '@/components/game/DebriefView.vue';
import GameHud from '@/components/game/GameHud.vue';
import GunnerHud from '@/components/game/GunnerHud.vue';
import IntercomWheel from '@/components/game/IntercomWheel.vue';
import NavigatorPanel from '@/components/game/NavigatorPanel.vue';
import PilotPanel from '@/components/game/PilotPanel.vue';
import RadioPanel from '@/components/game/RadioPanel.vue';
import { useI18n } from '@/composables/useI18n';
import type { GameFrame, GameHandle } from '@/game/boot';
import { codeLabel, indexBindings } from '@/game/input/bindings';
import { applyUiScale, inputPrefsFrom, withDefaults } from '@/game/settings';
import { dashboard } from '@/routes';
import type { Debrief, Station, TheatreConfig, WorldAction } from '@/sim/core';
import type { NetBootstrapData, UserSettingsData } from '@/types/generated/net';

/**
 * Игровой экран (раздел 12): canvas + оверлеи Vue поверх него без перерисовки 3D.
 * Общий для тренировок станций и одиночного вылета; в конце — оценка тренировки или разбор.
 */
const props = defineProps<{
    mode: 'mission' | 'training';
    station: Station;
    difficulty: 'training' | 'historical';
    seed: number;
    aircraftConfig: Record<string, unknown>;
    mission: Record<string, unknown>;
    theatre: { name: string; placeholder: boolean; definition: Record<string, unknown> };
    maxTimeScale?: number;
    /** Кооператив (этап 3): данные сессии, места игроков, отладочная задержка сети. */
    net?: { bootstrap: NetBootstrapData; humans: Station[]; delayMs: number };
    graphics?: 'low' | 'medium' | 'high';
    /** Кампания: прочность зон борта; звено: канал и место в строю (этап 6). */
    initialZones?: Record<string, number>;
    flight?: { ulid: string; slot: number; name: string } | null;
}>();
const emit = defineEmits<{ again: []; finished: [] }>();
const { t } = useI18n();

const container = ref<HTMLDivElement | null>(null);
const frame = shallowRef<GameFrame | null>(null);
const error = ref<string | null>(null);
const loading = ref(true);
const showHelp = ref(true);
const wheel = ref(false);
const demo = ref(false);
const debrief = shallowRef<Debrief | null>(null);
const chat = ref<{ from: string; text: string }[]>([]);
const chatText = ref('');
const finished = ref(false);
const voice = ref<{ enabled: boolean; peers: number; error: string | null }>({ enabled: false, peers: 0, error: null });
const talking = ref<number[]>([]);
const pttKey = computed(() => inputPrefsFrom(settings.value).bindings.voice_ptt[0] ?? 'KeyN');

async function toggleVoice(): Promise<void> {
    if (voice.value.enabled) {
        game?.disableVoice();

        return;
    }

    const ice = (page.props.voice as { ice?: { urls: string; username?: string; credential?: string }[] } | undefined)?.ice ?? [];

    await game?.enableVoice(ice, {
        onState: (s) => (voice.value = s),
        onTalking: (id, on) => (talking.value = on ? [...new Set([...talking.value, id])] : talking.value.filter((x) => x !== id)),
    });
}

// Тангента: говорить, пока клавиша нажата.
const onVoiceKey = (e: KeyboardEvent): void => {
    if (!voice.value.enabled || e.repeat || !(keymap.value.get(e.code) ?? []).includes('voice_ptt')) {
        return;
    }

    game?.setTalking(e.type === 'keydown');
};
let game: GameHandle | null = null;

const netState = computed(() => frame.value?.net ?? null);
const seatChangeIn = computed(() => {
    // От кадра, а не от статуса: обратный отсчёт обновляется с каждым кадром.
    const at = frame.value?.net?.seatChangeAt ?? null;

    return at === null ? null : Math.max(0, Math.ceil((at - performance.now()) / 1000));
});

function callsign(userId: number): string {
    return netState.value?.roster.find((r) => r.user_id === userId)?.callsign ?? `#${userId}`;
}

function finish(): void {
    if (!finished.value) {
        finished.value = true;
        // Хост сначала выгружает журнал и итог (POST /finish), клиенты — небольшая пауза на последние события.
        void Promise.all([game?.flushed(), new Promise((resolve) => window.setTimeout(resolve, 1500))]).then(() => emit('finished'));
    }
}

function sendChat(): void {
    const text = chatText.value.trim();

    if (text !== '') {
        game?.sendChat(text);
        chatText.value = '';
    }
}

const unsupported = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches && window.innerWidth < 1024;

function webgl2Available(): boolean {
    try {
        return document.createElement('canvas').getContext('webgl2') !== null;
    } catch {
        return false;
    }
}

const view = computed(() => frame.value?.view ?? null);
const station = computed<Station>(() => view.value?.station ?? props.station);
const gunner = computed(() => {
    const s = station.value;
    const f = frame.value;

    return s === 'top_gunner' || s === 'waist_gunner' || s === 'tail_gunner' || (s === 'radio' && f?.scope === true) || (s === 'bombardier' && f?.scope === false);
});

const page = usePage();
const settings = computed(() => withDefaults(page.props.settings as UserSettingsData | null | undefined));
const keymap = computed(() => indexBindings(inputPrefsFrom(settings.value).bindings));

const onKey = (e: KeyboardEvent): void => {
    if (e.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) {
        return;
    }

    const actions = keymap.value.get(e.code) ?? [];

    if (actions.includes('intercom_wheel') && !e.repeat) {
        wheel.value = !wheel.value;

        if (wheel.value && document.pointerLockElement) {
            document.exitPointerLock();
        }
    } else if (actions.includes('help')) {
        e.preventDefault();
        showHelp.value = !showHelp.value;
    }
};

onMounted(async () => {
    window.addEventListener('keydown', onKey);
    window.addEventListener('keydown', onVoiceKey);
    window.addEventListener('keyup', onVoiceKey);
    applyUiScale(settings.value);

    if (unsupported) {
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
                mode: props.mode,
                station: props.station,
                config: props.aircraftConfig,
                mission: props.mission,
                theatre: parseTheatre(props.theatre.definition) as TheatreConfig,
                difficulty: props.difficulty,
                seed: props.seed,
                maxTimeScale: props.maxTimeScale ?? 4,
                graphics: props.graphics,
                settings: settings.value,
                initialZones: props.initialZones,
                flight: props.flight ?? null,
                telemetry: page.props.auth?.user !== null && page.props.auth?.user !== undefined,
                net: props.net
                    ? {
                          ...props.net,
                          callbacks: {
                              onEnded: finish,
                              onChat: (from, text) => {
                                  chat.value = [...chat.value.slice(-19), { from: callsign(from), text }];
                              },
                          },
                      }
                    : undefined,
                onFrame: (f) => {
                    frame.value = f;

                    if (f.view.phase === 'debrief' && props.net) {
                        // Кооператив: разбор считает сервер по журналу (раздел 9.4).
                        finish();
                    } else if (f.view.phase === 'debrief' && props.mode === 'mission' && debrief.value === null) {
                        void game?.debrief().then((d) => (debrief.value = d));
                    }
                },
            });
        }
    } catch (e) {
        error.value = e instanceof Error ? e.message : String(e);
    } finally {
        loading.value = false;
    }
});

onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('keydown', onVoiceKey);
    window.removeEventListener('keyup', onVoiceKey);
    game?.dispose();
});

const act = (action: WorldAction): void => game?.act(action);
const timeScales = computed(() => ((props.maxTimeScale ?? 4) > 4 ? [1, 2, 4, props.maxTimeScale ?? 4] : [1, 2, 4]));
const switchStation = (s: Station): void => void game?.setStation(s);

async function toggleDemo(): Promise<void> {
    demo.value = !demo.value;
    await game?.setDemo(demo.value);
}

async function restart(): Promise<void> {
    demo.value = false;
    debrief.value = null;
    await game?.setDemo(false);
    await game?.restart();
}
</script>

<template>
    <div class="relative h-screen w-screen overflow-hidden bg-black text-stone-100 select-none">
        <div ref="container" class="absolute inset-0" data-test="game-canvas" />

        <div v-if="unsupported || error" class="absolute inset-0 flex items-center justify-center p-6">
            <div class="max-w-md rounded-lg border border-stone-700 bg-stone-900/90 p-6 text-center">
                <p v-if="unsupported">{{ t('training.unsupported_device') }}</p>
                <p v-else>{{ error }}</p>
                <Link :href="dashboard()" class="mt-4 inline-block underline">{{ t('training.back') }}</Link>
            </div>
        </div>

        <div v-else-if="loading" class="absolute inset-0 flex items-center justify-center">{{ t('training.loading') }}</div>

        <template v-if="frame && view && !debrief">
            <GameHud :frame="frame" :mode="mode" :subtitles="settings.subtitles" @switch="switchStation" />

            <PilotPanel v-if="station === 'pilot'" :view="view" @act="act" />
            <CopilotPanel v-else-if="station === 'copilot'" :view="view" :checklists="frame.statics.checklists" @act="act" />
            <BombardierPanel v-if="station === 'bombardier'" :view="view" :scope="frame.scope" @act="act" @scope="game?.toggleScope()" />
            <NavigatorPanel v-else-if="station === 'navigator'" :view="view" :statics="frame.statics" @act="act" />
            <RadioPanel v-else-if="station === 'radio'" :view="view" :statics="frame.statics" :scope="frame.scope" @act="act" @scope="game?.toggleScope()" />
            <GunnerHud v-if="gunner" :view="view" :station="station" :markers="frame.markers" :pointer-locked="frame.pointerLocked" @act="act" />

            <div class="pointer-events-auto absolute top-[4.25rem] right-3 flex gap-1 text-xs">
                <button class="rounded bg-black/60 px-2 py-1 hover:bg-black/80" data-test="toggle-help" @click="showHelp = !showHelp">{{ t('training.help') }}</button>
                <button v-if="difficulty === 'training'" class="rounded bg-black/60 px-2 py-1 hover:bg-black/80" @click="game?.toggleView()">{{ t('training.view') }}</button>
                <button class="rounded bg-black/60 px-2 py-1 hover:bg-black/80" data-test="toggle-autopilot" :aria-pressed="demo" @click="toggleDemo">
                    {{ demo ? t('training.autopilot_off') : mode === 'training' ? t('training.autopilot_on') : t('hud.ai_my_seat') }}
                </button>
                <button
                    v-for="s in timeScales"
                    :key="s"
                    class="rounded px-2 py-1"
                    :class="frame.timeScale === s ? 'bg-amber-700' : 'bg-black/60'"
                    :disabled="s > 1 && s <= 4 && !view.canAccelerate"
                    :title="t('hud.time_scale')"
                    :data-test="`time-${s}`"
                    @click="game?.setTimeScale(s)"
                >
                    ×{{ s }}
                </button>
                <template v-if="!net">
                    <button class="rounded bg-black/60 px-2 py-1 hover:bg-black/80" @click="game?.togglePause()">{{ t('training.pause') }}</button>
                    <button class="rounded bg-black/60 px-2 py-1 hover:bg-black/80" @click="restart">{{ t('training.restart') }}</button>
                </template>
                <Link :href="dashboard()" class="rounded bg-black/60 px-2 py-1 hover:bg-black/80">{{ t('training.exit') }}</Link>
            </div>

            <div v-if="showHelp" class="pointer-events-none absolute bottom-40 left-3 max-w-md rounded-md bg-black/65 p-3 text-xs leading-relaxed" data-test="help">
                <p class="mb-1 font-semibold">{{ t('training.help_title') }} — {{ t(`station.${station}`) }}</p>
                <p>{{ t(`keys.${station}`) }}</p>
                <p>{{ t('keys.common') }}</p>
                <p v-if="theatre.placeholder" class="mt-2 text-amber-300">{{ t('training.placeholder_theatre', { name: theatre.name }) }}</p>
            </div>

            <div class="pointer-events-none absolute right-40 bottom-3 rounded bg-black/50 px-2 py-1 font-mono text-xs" data-test="fps">
                {{ Math.round(frame.fps) }} FPS
                <span v-if="view.aircraft.touchdownVs !== null && view.aircraft.contact !== 'air'"> · {{ t('training.touchdown', { vs: view.aircraft.touchdownVs.toFixed(2) }) }}</span>
            </div>

            <IntercomWheel v-if="wheel" @act="act" @close="wheel = false" />

            <!-- Кооператив: состояние сети, смена места, смена хоста, чат (раздел 9). -->
            <template v-if="netState">
                <div class="pointer-events-none absolute top-[6.5rem] right-3 rounded bg-black/55 px-2 py-1 font-mono text-xs" data-test="net-status" :data-role="netState.role" :data-tick="view.tick" :data-host="netState.hostUserId">
                    {{ netState.role === 'host' ? t('session.role_host') : t('session.role_client') }}
                    <span v-if="netState.rttMs !== null"> · {{ t('session.rtt', { ms: netState.rttMs }) }}</span>
                    <span v-if="!netState.connected" class="text-red-400"> · {{ t('session.offline') }}</span>
                </div>
                <div v-if="seatChangeIn !== null" class="pointer-events-none absolute top-1/3 left-1/2 -translate-x-1/2 rounded bg-black/70 px-4 py-2 text-lg" data-test="seat-change">
                    {{ t('session.seat_change', { s: seatChangeIn }) }}
                </div>
                <div v-if="netState.migrating" class="pointer-events-none absolute inset-x-0 top-1/4 text-center" data-test="host-migration">
                    <span class="rounded bg-amber-800/90 px-5 py-2 text-xl">{{ t('session.host_migration') }}</span>
                </div>
                <div class="pointer-events-auto absolute top-[8.5rem] right-3 flex items-center gap-2 rounded bg-black/55 px-2 py-1 text-xs" data-test="voice">
                    <button class="rounded bg-black/60 px-2 py-0.5 hover:bg-black/80" data-test="voice-toggle" @click="toggleVoice">
                        {{ voice.enabled ? t('voice.disable') : t('voice.enable') }}
                    </button>
                    <span v-if="voice.enabled">{{ t('voice.ptt', { key: codeLabel(pttKey) }) }} · {{ t('voice.peers', { n: voice.peers }) }}</span>
                    <span v-if="voice.error" class="text-red-400">{{ t('voice.error') }}</span>
                    <span v-for="id in talking" :key="id" class="rounded bg-green-700 px-1">{{ callsign(id) }} — {{ t('voice.talking') }}</span>
                </div>
                <div v-if="netState.protocolError" class="absolute inset-0 flex items-center justify-center bg-black/70 text-lg">{{ t('session.error.protocol') }}</div>
                <div class="pointer-events-auto absolute bottom-40 right-3 w-72 space-y-1 text-xs" data-test="chat">
                    <div v-for="(m, i) in chat" :key="i" class="rounded bg-black/50 px-2 py-0.5">
                        <span class="text-amber-300">{{ m.from }}:</span> {{ m.text }}
                    </div>
                    <form class="flex gap-1" @submit.prevent="sendChat">
                        <input
                            v-model="chatText"
                            maxlength="200"
                            class="min-w-0 flex-1 rounded bg-black/60 px-2 py-1"
                            :placeholder="t('session.chat_placeholder')"
                            data-test="chat-input"
                            @keydown.stop
                            @keyup.stop
                        />
                        <button class="rounded bg-black/60 px-2 py-1">{{ t('session.chat_send') }}</button>
                    </form>
                </div>
            </template>
            <div v-if="finished" class="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/60 text-2xl" data-test="session-finished">{{ t('session.finished') }}</div>

            <div v-if="frame.paused" class="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40 text-2xl">{{ t('training.paused') }}</div>

            <div v-if="view.crewFlags.bailOutOrdered && view.aircraft.contact === 'air' && !view.crew.find((c) => c.station === station)?.bailedOut" class="pointer-events-auto absolute top-1/4 left-1/2 -translate-x-1/2">
                <button class="rounded bg-red-700 px-6 py-3 text-lg font-bold" data-test="jump" @click="act({ type: 'jump' })">{{ t('crew.jump') }}</button>
            </div>

            <!-- Итог тренировки. -->
            <div v-if="mode === 'training' && view.training?.done" class="pointer-events-auto absolute inset-0 flex items-center justify-center bg-black/60" data-test="training-result" :data-score="view.training.score">
                <div class="w-96 space-y-3 rounded-lg bg-stone-900 p-6 text-center">
                    <div class="text-sm text-stone-400">{{ t('training.result', { station: t(`station.${station}`) }) }}</div>
                    <div class="text-5xl font-bold text-amber-300">{{ view.training.score }}</div>
                    <div v-for="m in view.training.metrics" :key="m.key" class="flex justify-between text-sm">
                        <span>{{ t(`metric.${m.key}`) }}</span>
                        <span class="font-mono">{{ m.value ?? '—' }} {{ m.unit }}</span>
                    </div>
                    <div class="flex justify-center gap-2">
                        <button class="rounded bg-amber-600 px-4 py-2" @click="restart">{{ t('training.restart') }}</button>
                        <Link :href="dashboard()" class="rounded bg-stone-700 px-4 py-2">{{ t('training.exit') }}</Link>
                    </div>
                </div>
            </div>

            <div v-if="view.aircraft.contact === 'crashed' && mode === 'training' && !view.training?.done" class="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/50 text-2xl">
                {{ t('training.crashed') }}
                <button class="rounded bg-stone-100 px-4 py-2 text-base text-stone-900" @click="restart">{{ t('training.restart') }}</button>
            </div>
        </template>

        <DebriefView v-if="debrief" :debrief="debrief" :you="station" @again="emit('again')" @exit="$inertia.visit(dashboard().url)" />
    </div>
</template>
