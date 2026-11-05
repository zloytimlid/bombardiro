<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from '@/composables/useI18n';
import type { WorldAction } from '@/sim/core';

/**
 * Колесо быстрых команд СПУ (клавиша Q, раздел 6.7): фразы из каталога и доклад об угрозе
 * по часовой системе («истребитель, 4 часа, выше») — метка появляется у всего экипажа на 10 с.
 */
const emit = defineEmits<{ act: [action: WorldAction]; close: [] }>();
const { t } = useI18n();
const level = ref<'high' | 'level' | 'low'>('level');
const kind = ref<'fighter' | 'flak'>('fighter');

const phrases = ['intercom.ready', 'intercom.roger', 'intercom.repeat', 'intercom.hits_on_target_short', 'intercom.bombs_away', 'intercom.all_clear', 'intercom.help'];

const say = (key: string): void => {
    emit('act', { type: 'intercom', key, params: {} });
    emit('close');
};
const report = (clock: number): void => {
    emit('act', { type: 'report_threat', clock, level: level.value, kind: kind.value });
    emit('close');
};
</script>

<template>
    <div class="pointer-events-auto absolute inset-0 flex items-center justify-center bg-black/30" data-test="intercom-wheel" @click.self="emit('close')">
        <div class="relative h-[26rem] w-[26rem] rounded-full border border-stone-500 bg-black/75">
            <button
                v-for="clock in 12"
                :key="clock"
                class="absolute h-10 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-800 font-mono hover:bg-amber-600"
                :style="{ left: `${50 + Math.sin((clock / 12) * Math.PI * 2) * 42}%`, top: `${50 - Math.cos((clock / 12) * Math.PI * 2) * 42}%` }"
                :data-test="`clock-${clock}`"
                @click="report(clock)"
            >
                {{ clock }}
            </button>
            <div class="absolute top-1/2 left-1/2 flex w-56 -translate-x-1/2 -translate-y-1/2 flex-col gap-1 text-xs">
                <div class="flex justify-center gap-1">
                    <button v-for="k in ['fighter', 'flak'] as const" :key="k" class="rounded px-2 py-0.5" :class="kind === k ? 'bg-amber-700' : 'bg-stone-700'" @click="kind = k">{{ t(`threat.${k}`) }}</button>
                </div>
                <div class="flex justify-center gap-1">
                    <button v-for="l in ['high', 'level', 'low'] as const" :key="l" class="rounded px-2 py-0.5" :class="level === l ? 'bg-amber-700' : 'bg-stone-700'" @click="level = l">{{ t(`level.${l}`) }}</button>
                </div>
                <button v-for="p in phrases" :key="p" class="rounded bg-stone-800 px-2 py-0.5 hover:bg-stone-600" @click="say(p)">{{ t(p, { count: 0, miss: 0 }) }}</button>
            </div>
        </div>
    </div>
</template>
