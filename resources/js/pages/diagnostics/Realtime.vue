<script setup lang="ts">
import { Head, usePage } from '@inertiajs/vue3';
import { useConnectionStatus, usePresenceChannel } from '@laravel/echo-vue';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useI18n } from '@/composables/useI18n';
import { radioCheck } from '@/routes/diagnostics';

type Member = { id: number; callsign: string };
type RadioMessage = { callsign: string; message: string };
type LogEntry = { kind: 'broadcast' | 'whisper'; text: string };

const { t } = useI18n();
const page = usePage();

const members = ref<Member[]>([]);
const log = ref<LogEntry[]>([]);
const message = ref('radio-check');
const status = useConnectionStatus();

const statusLabel = computed(() => {
    if (status.value === 'connected') {
        return t('realtime.status.connected');
    }

    return status.value === 'connecting' || status.value === 'reconnecting'
        ? t('realtime.status.connecting')
        : t('realtime.status.disconnected');
});

const { channel } = usePresenceChannel('diagnostics');

function myCallsign(): string {
    const me = members.value.find((m) => m.id === page.props.auth.user.id);

    return me?.callsign ?? page.props.auth.user.name;
}

function push(entry: LogEntry): void {
    log.value = [entry, ...log.value].slice(0, 20);
}

// Канал Echo живёт дольше компонента: без снятия слушателей повторный монтаж дублирует события.
onBeforeUnmount(() => {
    channel().stopListening('.radio-check').stopListeningForWhisper('radio-check');
});

onMounted(() => {
    channel()
        .stopListening('.radio-check')
        .stopListeningForWhisper('radio-check')
        .here((list: Member[]) => {
            members.value = list;
        })
        .joining((member: Member) => {
            members.value = [
                ...members.value.filter((m) => m.id !== member.id),
                member,
            ];
        })
        .leaving((member: Member) => {
            members.value = members.value.filter((m) => m.id !== member.id);
        })
        .listen('.radio-check', (payload: RadioMessage) => {
            push({ kind: 'broadcast', text: t('realtime.received_broadcast', payload) });
        })
        .listenForWhisper('radio-check', (payload: RadioMessage) => {
            push({ kind: 'whisper', text: t('realtime.received_whisper', payload) });
        });
});

async function sendBroadcast(): Promise<void> {
    const xsrf = decodeURIComponent(
        document.cookie.match(/(?:^|; )XSRF-TOKEN=([^;]+)/)?.[1] ?? '',
    );

    await fetch(radioCheck.url(), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'X-XSRF-TOKEN': xsrf,
        },
        credentials: 'same-origin',
        body: JSON.stringify({ message: message.value }),
    });
}

function sendWhisper(): void {
    // Отправитель свой whisper не получает — это поведение протокола Pusher.
    channel().whisper('radio-check', {
        callsign: myCallsign(),
        message: message.value,
    });
}
</script>

<template>
    <Head :title="t('realtime.title')" />

    <div class="flex flex-col gap-4 p-4">
        <div>
            <h1 class="text-xl font-semibold">{{ t('realtime.title') }}</h1>
            <p class="text-sm text-muted-foreground">
                {{ t('realtime.description') }}
            </p>
        </div>

        <div class="flex gap-6 text-sm">
            <span data-test="realtime-status" :data-status="status">
                {{ t('realtime.status', { status: statusLabel }) }}
            </span>
            <span data-test="realtime-members" :data-count="members.length">
                {{ t('realtime.members', { count: members.length }) }}
            </span>
        </div>

        <ul class="flex flex-wrap gap-2 text-sm">
            <li
                v-for="member in members"
                :key="member.id"
                class="rounded border px-2 py-0.5 font-mono"
                data-test="realtime-member"
            >
                {{ member.callsign }}
            </li>
        </ul>

        <div class="flex gap-2">
            <Input
                v-model="message"
                maxlength="120"
                class="max-w-xs"
                data-test="radio-message"
                :aria-label="t('realtime.message')"
            />
            <Button data-test="send-broadcast" @click="sendBroadcast">
                {{ t('realtime.send_broadcast') }}
            </Button>
            <Button variant="outline" data-test="send-whisper" @click="sendWhisper">
                {{ t('realtime.send_whisper') }}
            </Button>
        </div>

        <ul class="flex flex-col gap-1 font-mono text-sm" data-test="realtime-log">
            <li v-if="log.length === 0" class="text-muted-foreground">
                {{ t('realtime.log_empty') }}
            </li>
            <li v-for="(entry, i) in log" :key="i" :data-kind="entry.kind">
                {{ entry.text }}
            </li>
        </ul>
    </div>
</template>
