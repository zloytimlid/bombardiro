<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from '@/composables/useI18n';
import type { RadioMeaning, WorldAction } from '@/sim/core';
import { RADIO_MEANINGS } from '@/sim/core';
import type { MissionStatic, WorldView } from '@/sim/view';

/**
 * Радист (раздел 6.5): ручка частоты по шуму (колесо мыши, ±), расшифровка принятых групп
 * по кодовой таблице дня, «свой-чужой», сигнал бедствия. T — к левому бортовому пулемёту.
 */
const props = defineProps<{ view: WorldView; statics: MissionStatic; scope: boolean }>();
const emit = defineEmits<{ act: [action: WorldAction]; scope: [] }>();
const { t } = useI18n();

const r = computed(() => props.view.radio);
const signal = computed(() => Math.round((1 - r.value.noise) * 100));
const tune = (delta: number): void => emit('act', { type: 'radio_dial', mhz: Math.min(8, Math.max(3, r.value.dialMhz + delta)) });
const decode = (messageId: string, meaning: string): void => emit('act', { type: 'decode', messageId, meaning: meaning as RadioMeaning });
</script>

<template>
    <div v-if="!scope" class="pointer-events-auto absolute top-28 right-3 w-96 space-y-2 rounded-md bg-black/75 p-3 text-xs" data-test="radio-panel">
        <div class="flex items-center justify-between">
            <span class="font-semibold">{{ t('radio.set') }}</span>
            <span v-if="r.failed" class="text-red-400">{{ t('radio.failed') }}</span>
            <button class="rounded bg-stone-700 px-2 py-0.5" @click="emit('scope')">{{ t('radio.to_gun') }} (T)</button>
        </div>
        <div class="flex items-center gap-2">
            <button class="rounded bg-stone-700 px-2" @click="tune(-0.1)">«</button>
            <button class="rounded bg-stone-700 px-2" @click="tune(-0.01)">‹</button>
            <span class="w-24 text-center font-mono text-lg text-amber-200" data-test="dial">{{ r.dialMhz.toFixed(3) }}</span>
            <button class="rounded bg-stone-700 px-2" @click="tune(0.01)">›</button>
            <button class="rounded bg-stone-700 px-2" @click="tune(0.1)">»</button>
            <span>MHz</span>
        </div>
        <div>
            {{ t('radio.signal') }}
            <div class="h-2 rounded bg-stone-700"><div class="h-2 rounded bg-emerald-400" :style="{ width: `${signal}%` }" /></div>
            <div class="mt-0.5 text-stone-400">{{ r.activeTransmissions > 0 ? t('radio.on_air') : t('radio.quiet') }}</div>
        </div>
        <div class="text-stone-300">
            {{ t('radio.briefed') }}: {{ t('radio.tower') }} {{ statics.frequencies.tower }} · {{ t('radio.command') }} {{ statics.frequencies.command }} · {{ t('radio.base') }} {{ statics.frequencies.base }}
        </div>

        <div>
            <div class="font-semibold">{{ t('radio.received') }}</div>
            <div v-for="m in r.received" :key="m.messageId" class="flex items-center gap-2" :data-test="`message-${m.messageId}`">
                <span class="w-14 font-mono">{{ m.group }}</span>
                <select v-if="m.decoded === null" class="flex-1 rounded bg-stone-800" @change="decode(m.messageId, ($event.target as HTMLSelectElement).value)">
                    <option value="">{{ t('radio.decode') }}</option>
                    <option v-for="meaning in RADIO_MEANINGS" :key="meaning" :value="meaning">{{ t(`radio_meaning.${meaning}`) }}</option>
                </select>
                <span v-else :class="m.correct ? 'text-emerald-300' : 'text-red-300'">{{ t(`radio_meaning.${m.decoded}`) }}</span>
            </div>
            <div v-if="r.received.length === 0" class="text-stone-400">{{ t('radio.nothing') }}</div>
        </div>

        <details>
            <summary class="cursor-pointer">{{ t('radio.code_table') }}</summary>
            <div v-for="c in statics.codeTable" :key="c.group" class="font-mono">{{ c.group }} — {{ t(`radio_meaning.${c.meaning}`) }}</div>
        </details>

        <div class="flex gap-2">
            <button class="rounded px-2 py-0.5" :class="r.iff ? 'bg-emerald-700' : 'bg-stone-700'" data-test="iff" @click="emit('act', { type: 'iff', on: !r.iff })">{{ t('radio.iff') }}: {{ r.iff ? t('common.on') : t('common.off') }}</button>
            <button class="rounded bg-red-900 px-2 py-0.5" :disabled="r.distressSent" @click="emit('act', { type: 'distress' })">{{ r.distressSent ? t('radio.distress_sent') : t('radio.distress') }}</button>
        </div>
        <p class="text-stone-400">{{ t('radio.keys') }}</p>
    </div>
</template>
