<script setup lang="ts">
import { Head, router } from '@inertiajs/vue3';
import { echo } from '@laravel/echo-vue';
import { Check } from '@lucide/vue';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from '@/composables/useI18n';
import { api, ApiError, timed } from '@/game/net/api';
import { STATIONS } from '@/sim/core/config';

/**
 * Лобби экипажа (раздел 11): места, готовность, сложность, старт вылета.
 * Состав приходит событиями presence-crew.{crew}; кто на связи — из присутствия канала.
 */
type Member = { user_id: number; callsign: string; seat: string | null; is_ready: boolean; rtt_ms: number | null };
type Roster = {
    ulid: string;
    rev: number;
    name: string;
    invite_code: string;
    status: string;
    owner_id: number;
    host_user_id: number | null;
    max_players: number;
    difficulty: string;
    mission: { slug: string; title: Record<string, string> };
    members: Member[];
    campaign: { slug: string; title: Record<string, string>; step: number; day: number; missions: string[]; damaged: Record<string, number>; completed: boolean } | null;
    flight: { ulid: string; invite_code: string; slot: number; leader: boolean; crews: { name: string; slot: number }[] } | null;
};
type CampaignItem = { slug: string; title: Record<string, string> };

const props = defineProps<{ crew: Roster; activeSession: string | null; userId: number }>();
const { t, locale } = useI18n();

const roster = ref<Roster>(props.crew);
const online = ref<number[]>([]);
const error = ref<string | null>(null);
const busy = ref(false);
const rtt = ref<number | null>(null);
const copied = ref(false);
let heartbeat: number | null = null;

const me = computed(() => roster.value.members.find((m) => m.user_id === props.userId) ?? null);
const isOwner = computed(() => roster.value.owner_id === props.userId);
const seated = computed(() => roster.value.members.filter((m) => m.seat !== null));
const canStart = computed(() => isOwner.value && seated.value.length > 0 && seated.value.every((m) => m.is_ready));
/** Состав приходит и ответами API, и событиями — не по порядку; устаревшие ревизии пропускаем. */
function applyRoster(next: Roster): void {
    if (next.rev >= roster.value.rev) {
        roster.value = next;
    }
}

const occupant = (seat: string): Member | undefined => roster.value.members.find((m) => m.seat === seat);

type EchoPresence = {
    here(cb: (m: { id: number }[]) => void): EchoPresence;
    joining(cb: (m: { id: number }) => void): EchoPresence;
    leaving(cb: (m: { id: number }) => void): EchoPresence;
    listen(event: string, cb: (e: unknown) => void): EchoPresence;
};
const channelName = `crew.${props.crew.ulid}`;

async function call(method: 'POST' | 'DELETE' | 'PATCH', url: string, body?: unknown): Promise<void> {
    error.value = null;
    busy.value = true;

    try {
        const res = await api<{ data?: Roster }>(method, url, body);

        if (res.data && 'members' in res.data) {
            applyRoster(res.data);
        }
    } catch (e) {
        // 409 — место уже заняли (раздел 9.3), сообщение сервера уже локализовано.
        error.value = e instanceof ApiError ? e.message : String(e);
    } finally {
        busy.value = false;
    }
}

const claim = (seat: string): Promise<void> => call('POST', `/api/crews/${roster.value.ulid}/seats/${seat}`);
const release = (seat: string): Promise<void> => call('DELETE', `/api/crews/${roster.value.ulid}/seats/${seat}`);
const toggleReady = (): Promise<void> => call('POST', `/api/crews/${roster.value.ulid}/ready`, { ready: !(me.value?.is_ready ?? false) });
const setDifficulty = (difficulty: string): Promise<void> => call('PATCH', `/api/crews/${roster.value.ulid}`, { difficulty });

// ── Кампания и звено (этап 6).
const campaigns = ref<CampaignItem[]>([]);
const flightCode = ref('');
const canLaunch = computed(() => canStart.value && (roster.value.flight === null || roster.value.flight.leader));
const enroll = (slug: string): Promise<void> => (slug === '' ? call('DELETE', `/api/crews/${roster.value.ulid}/campaign`) : call('POST', `/api/crews/${roster.value.ulid}/campaign`, { campaign: slug }));
const repair = (): Promise<void> => call('POST', `/api/crews/${roster.value.ulid}/campaign/repair`);

async function flightAction(method: 'POST' | 'DELETE', path: string, body?: unknown): Promise<void> {
    error.value = null;
    busy.value = true;

    try {
        await api(method, `/api/crews/${roster.value.ulid}/${path}`, body);
        // Состав со звеном — свежим запросом страницы.
        router.reload({ only: ['crew'], onSuccess: (p) => applyRoster((p.props as unknown as { crew: Roster }).crew) });
    } catch (e) {
        error.value = e instanceof ApiError ? e.message : String(e);
    } finally {
        busy.value = false;
    }
}

async function start(): Promise<void> {
    error.value = null;
    busy.value = true;

    try {
        // Звено стартует ведущий — все экипажи звена сразу (этап 6).
        if (roster.value.flight) {
            const res = await api<{ data: { sessions: { crew: string; session: string }[] } }>('POST', `/api/flights/${roster.value.flight.ulid}/start`);
            const mine = res.data.sessions.find((s) => s.crew === roster.value.ulid);

            if (mine) {
                router.visit(`/play/${mine.session}`);
            }

            return;
        }

        const res = await api<{ data: { session: string } }>('POST', `/api/crews/${roster.value.ulid}/start`);

        router.visit(`/play/${res.data.session}`);
    } catch (e) {
        error.value = e instanceof ApiError ? e.message : String(e);
    } finally {
        busy.value = false;
    }
}

async function leave(): Promise<void> {
    await call('DELETE', `/api/crews/${roster.value.ulid}/members/me`);

    if (error.value === null) {
        router.visit('/missions');
    }
}

async function copyCode(): Promise<void> {
    await navigator.clipboard?.writeText(roster.value.invite_code);
    copied.value = true;
    window.setTimeout(() => (copied.value = false), 1500);
}

async function beat(): Promise<void> {
    try {
        const { rttMs } = await timed(() => api('POST', `/api/crews/${roster.value.ulid}/heartbeat`, { rtt_ms: rtt.value }));

        rtt.value = rttMs;
    } catch {
        // Сеть пропала — место держится 120 с (раздел 9.3), повторим на следующем такте.
    }
}

onMounted(() => {
    const onRoster = (e: unknown): void => applyRoster((e as { roster: Roster }).roster);

    (echo().join(channelName) as unknown as EchoPresence)
        .here((m) => (online.value = m.map((x) => x.id)))
        .joining((m) => (online.value = [...new Set([...online.value, m.id])]))
        .leaving((m) => (online.value = online.value.filter((x) => x !== m.id)))
        .listen('.SeatClaimed', onRoster)
        .listen('.CrewReady', onRoster)
        .listen('.SessionStarted', (e) => router.visit(`/play/${(e as { session: string }).session}`));

    void beat();
    heartbeat = window.setInterval(() => void beat(), 5000);
    void api<{ data: CampaignItem[] }>('GET', '/api/campaigns').then((r) => (campaigns.value = r.data)).catch(() => undefined);
});

onBeforeUnmount(() => {
    if (heartbeat !== null) {
        window.clearInterval(heartbeat);
    }

    echo().leave(channelName);
});
</script>

<template>
    <Head :title="t('lobby.title', { name: roster.name })" />
    <div class="mx-auto max-w-4xl space-y-6 p-6" data-test="lobby">
        <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
                <h1 class="text-2xl font-semibold">{{ roster.name }}</h1>
                <p class="text-sm text-muted-foreground">{{ roster.mission.title[locale] ?? roster.mission.slug }}</p>
            </div>
            <div class="flex items-center gap-2 text-sm">
                <span class="text-muted-foreground">{{ t('lobby.invite_code') }}</span>
                <button class="rounded border px-3 py-1 font-mono text-lg tracking-widest" data-test="invite-code" @click="copyCode">{{ roster.invite_code }}</button>
                <span v-if="copied" class="text-xs text-green-600">{{ t('lobby.copied') }}</span>
            </div>
        </div>

        <div v-if="activeSession" class="flex items-center justify-between rounded border border-amber-500 bg-amber-50 p-3 text-sm dark:bg-amber-950">
            <span>{{ t('lobby.session_running') }}</span>
            <a :href="`/play/${activeSession}`" class="rounded bg-amber-600 px-3 py-1 text-white" data-test="rejoin">{{ t('lobby.rejoin') }}</a>
        </div>

        <p v-if="error" class="rounded bg-red-100 p-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200" data-test="lobby-error">{{ error }}</p>

        <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div
                v-for="seat in STATIONS"
                :key="seat"
                class="space-y-2 rounded-lg border p-3"
                :class="occupant(seat)?.user_id === userId ? 'border-amber-500' : ''"
                :data-test="`seat-${seat}`"
            >
                <div class="text-sm font-semibold">{{ t(`station.${seat}`) }}</div>
                <div class="min-h-5 text-sm">
                    <template v-if="occupant(seat)">
                        <span :class="online.includes(occupant(seat)!.user_id) ? '' : 'text-muted-foreground line-through'">{{ occupant(seat)!.callsign }}</span>
                        <Check v-if="occupant(seat)!.is_ready" class="ml-1 inline size-4 text-green-600" :aria-label="t('lobby.ready_on')" />
                    </template>
                    <span v-else class="text-muted-foreground">{{ t('lobby.ai_seat') }}</span>
                </div>
                <button
                    v-if="!occupant(seat)"
                    class="w-full rounded bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-50"
                    :disabled="busy"
                    :data-test="`claim-${seat}`"
                    @click="claim(seat)"
                >
                    {{ t('lobby.take_seat') }}
                </button>
                <button v-else-if="occupant(seat)!.user_id === userId" class="w-full rounded border px-2 py-1 text-xs" :disabled="busy" @click="release(seat)">
                    {{ t('lobby.release_seat') }}
                </button>
            </div>
        </div>

        <div class="flex flex-wrap items-center gap-3">
            <label class="flex items-center gap-2 text-sm">
                {{ t('lobby.difficulty') }}
                <select
                    class="rounded border bg-background px-2 py-1"
                    :value="roster.difficulty"
                    :disabled="!isOwner || busy"
                    data-test="difficulty"
                    @change="setDifficulty(($event.target as HTMLSelectElement).value)"
                >
                    <option value="training">{{ t('difficulty.training') }}</option>
                    <option value="historical">{{ t('difficulty.historical') }}</option>
                </select>
            </label>
            <button
                v-if="me?.seat"
                class="rounded px-4 py-2 text-sm"
                :class="me.is_ready ? 'bg-green-600 text-white' : 'border'"
                :disabled="busy"
                data-test="ready"
                @click="toggleReady"
            >
                {{ me.is_ready ? t('lobby.ready_on') : t('lobby.ready_off') }}
            </button>
            <button v-if="isOwner" class="rounded bg-amber-600 px-4 py-2 text-sm text-white disabled:opacity-50" :disabled="!canLaunch || busy" data-test="start" @click="start">
                {{ t('lobby.start') }}
            </button>
            <span v-else class="text-sm text-muted-foreground">{{ t('lobby.wait_owner') }}</span>
            <span v-if="rtt !== null" class="ml-auto font-mono text-xs text-muted-foreground">{{ t('session.rtt', { ms: rtt }) }}</span>
            <button class="rounded border px-3 py-2 text-sm" data-test="leave" @click="leave">{{ t('lobby.leave') }}</button>
        </div>

        <p class="text-xs text-muted-foreground">{{ t('lobby.hint', { n: roster.max_players }) }}</p>

        <!-- Кампания (этап 6): борт и повреждения между вылетами. -->
        <section class="space-y-2 rounded-lg border p-4" data-test="lobby-campaign">
            <div class="flex flex-wrap items-center gap-3">
                <h2 class="font-semibold">{{ t('campaign.title') }}</h2>
                <select
                    class="rounded border bg-background px-2 py-1 text-sm"
                    :value="roster.campaign?.slug ?? ''"
                    :disabled="!isOwner || busy"
                    data-test="campaign-select"
                    @change="enroll(($event.target as HTMLSelectElement).value)"
                >
                    <option value="">{{ t('campaign.none') }}</option>
                    <option v-for="c in campaigns" :key="c.slug" :value="c.slug">{{ c.title[locale] ?? c.slug }}</option>
                </select>
                <template v-if="roster.campaign">
                    <span class="text-sm" data-test="campaign-progress">
                        {{ roster.campaign.completed ? t('campaign.completed') : t('campaign.progress', { step: roster.campaign.step + 1, total: roster.campaign.missions.length, day: roster.campaign.day }) }}
                    </span>
                    <button v-if="isOwner && !roster.campaign.completed" class="rounded border px-2 py-1 text-xs" :disabled="busy" data-test="campaign-repair" @click="repair">{{ t('campaign.repair') }}</button>
                </template>
            </div>
            <p v-if="roster.campaign" class="text-xs text-muted-foreground" data-test="campaign-damage">
                {{ t('campaign.damage') }}:
                <template v-if="Object.keys(roster.campaign.damaged).length > 0">
                    <span v-for="(share, zone) in roster.campaign.damaged" :key="zone" class="mr-2 font-mono">{{ zone }} {{ Math.round(share * 100) }}%</span>
                </template>
                <span v-else>{{ t('campaign.airframe_ok') }}</span>
            </p>
        </section>

        <!-- Звено до 4 экипажей (этап 6). -->
        <section class="space-y-2 rounded-lg border p-4" data-test="lobby-flight">
            <div class="flex flex-wrap items-center gap-3">
                <h2 class="font-semibold">{{ t('flight.title') }}</h2>
                <template v-if="roster.flight">
                    <span class="text-sm">{{ t('flight.code') }}: <span class="font-mono tracking-widest" data-test="flight-code">{{ roster.flight.invite_code }}</span></span>
                    <span v-for="c in roster.flight.crews" :key="c.slot" class="rounded bg-muted px-2 py-0.5 text-xs">{{ t('flight.slot', { n: c.slot + 1 }) }} · {{ c.name }}<template v-if="c.slot === 0"> · {{ t('flight.leader') }}</template></span>
                    <button v-if="isOwner" class="ml-auto rounded border px-2 py-1 text-xs" :disabled="busy" data-test="flight-leave" @click="flightAction('DELETE', 'flight')">{{ t('flight.leave') }}</button>
                </template>
                <template v-else-if="isOwner">
                    <button class="rounded border px-2 py-1 text-xs" :disabled="busy" data-test="flight-create" @click="flightAction('POST', 'flight')">{{ t('flight.create') }}</button>
                    <input v-model="flightCode" maxlength="8" class="w-28 rounded border bg-background px-2 py-1 font-mono text-xs uppercase" :placeholder="t('flight.code')" data-test="flight-join-code" />
                    <button class="rounded border px-2 py-1 text-xs" :disabled="busy || flightCode.trim().length !== 8" data-test="flight-join" @click="flightAction('POST', 'flight/join', { invite_code: flightCode.trim().toUpperCase() })">{{ t('flight.join') }}</button>
                </template>
            </div>
            <p class="text-xs text-muted-foreground">{{ t('flight.hint') }}</p>
        </section>
    </div>
</template>
