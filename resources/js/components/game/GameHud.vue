<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from '@/composables/useI18n';
import type { GameFrame } from '@/game/boot';
import { intercomText, speakerName } from '@/game/ui/format';
import type { Station } from '@/sim/core';
import { STATIONS } from '@/sim/core';

/**
 * Общий оверлей любой станции (раздел 12): полоса экипажа (8 значков), фаза и задача,
 * лента СПУ (5 сообщений), круговой индикатор угроз по часовой системе, индикатор связи.
 * Маркеры угроз различимы без цвета: форма + подпись (доступность).
 */
const props = defineProps<{ frame: GameFrame; mode: 'mission' | 'training' }>();
const emit = defineEmits<{ switch: [station: Station] }>();
const { t } = useI18n();

const view = computed(() => props.frame.view);
const crew = computed(() => STATIONS.map((s, i) => ({ station: s, key: i + 1, member: view.value.crew.find((c) => c.station === s) })));

const statusMark = (m: (typeof view.value.crew)[number] | undefined): string => {
    if (!m) {
        return '?';
    }

    if (m.bailedOut) {
        return '⇣';
    }

    return m.health === 'ok' ? '●' : m.health === 'wounded' ? '▲' : '✕';
};

const threats = computed(() =>
    view.value.threats.map((th) => {
        const angle = ((th.clock % 12) / 12) * Math.PI * 2;

        return { ...th, x: 50 + Math.sin(angle) * 38, y: 50 - Math.cos(angle) * 38 };
    }),
);
</script>

<template>
    <!-- Полоса экипажа: клик или 1–8 — переход на станцию. -->
    <div class="pointer-events-auto absolute top-2 left-1/2 flex -translate-x-1/2 gap-1" data-test="crew-bar">
        <button
            v-for="c in crew"
            :key="c.station"
            class="flex min-w-[5.5rem] flex-col items-center rounded border px-2 py-1 text-[11px] leading-tight"
            :class="c.station === view.station ? 'border-amber-300 bg-amber-300/25' : 'border-stone-600 bg-black/60 hover:bg-black/80'"
            :data-test="`station-${c.station}`"
            :aria-pressed="c.station === view.station"
            @click="emit('switch', c.station)"
        >
            <span class="font-mono text-stone-400">{{ c.key }}</span>
            <span class="truncate">{{ t(`station.${c.station}`) }}</span>
            <span class="font-mono">
                {{ statusMark(c.member) }}
                <span class="text-stone-400">{{ c.member?.controller === 'ai' ? t('hud.ai') : t('hud.you') }}</span>
                <span v-if="c.member?.task" class="text-amber-300"> · {{ t(`task.${c.member.task}`) }}</span>
            </span>
        </button>
    </div>

    <!-- Фаза и задача станции. -->
    <div class="pointer-events-none absolute top-20 left-3 rounded bg-black/55 px-3 py-1.5 text-sm" data-test="phase" :data-phase="view.phase">
        <div class="font-semibold">{{ t(`phase.${view.phase}`) }}</div>
        <div class="text-xs text-stone-300">{{ t(`task_hint.${view.station}`) }}</div>
        <div class="mt-1 font-mono text-[11px] text-stone-400">
            T+{{ Math.floor(view.timeS / 60) }}:{{ String(Math.floor(view.timeS % 60)).padStart(2, '0') }}
            · {{ t('hud.link_local') }}
            <span v-if="frame.timeScale > 1 && view.canAccelerate"> · ×{{ frame.timeScale }}</span>
        </div>
    </div>

    <!-- Лента СПУ. -->
    <div class="pointer-events-none absolute bottom-3 left-3 w-[26rem] space-y-0.5 text-xs" data-test="intercom">
        <div v-for="(m, i) in view.intercom" :key="`${m.tick}-${i}`" class="rounded bg-black/55 px-2 py-0.5">
            <span class="font-semibold text-amber-200">{{ speakerName(t, m.from) }}:</span>
            {{ intercomText(t, m) }}
        </div>
    </div>

    <!-- Круговой индикатор угроз. -->
    <svg class="pointer-events-none absolute right-3 bottom-3 h-36 w-36" viewBox="0 0 100 100" data-test="threat-ring" :data-count="threats.length">
        <circle cx="50" cy="50" r="46" fill="rgba(0,0,0,0.45)" stroke="#a8a29e" stroke-width="0.8" />
        <circle cx="50" cy="50" r="30" fill="none" stroke="#57534e" stroke-width="0.5" />
        <text v-for="h in [12, 3, 6, 9]" :key="h" :x="50 + Math.sin((h / 12) * Math.PI * 2) * 44" :y="52 - Math.cos((h / 12) * Math.PI * 2) * 44" font-size="6" fill="#d6d3d1" text-anchor="middle">{{ h }}</text>
        <path d="M50 44 L54 54 L50 51 L46 54 Z" fill="#e7e5e4" />
        <g v-for="th in threats" :key="th.id">
            <polygon v-if="th.kind === 'fighter'" :points="`${th.x},${th.y - 5} ${th.x + 4.5},${th.y + 3.5} ${th.x - 4.5},${th.y + 3.5}`" fill="#fbbf24" stroke="#000" stroke-width="0.6" />
            <rect v-else :x="th.x - 3.5" :y="th.y - 3.5" width="7" height="7" fill="#f87171" stroke="#000" stroke-width="0.6" />
            <text :x="th.x" :y="th.y + 10" font-size="5.5" fill="#fff" text-anchor="middle">{{ th.clock }} {{ th.level === 'high' ? '↑' : th.level === 'low' ? '↓' : '—' }}</text>
        </g>
    </svg>
</template>
