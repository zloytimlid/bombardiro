<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from '@/composables/useI18n';
import { fixed, KG_PER_US_GAL } from '@/game/ui/format';
import type { ChecklistId, EngineControlsSet, WorldAction } from '@/sim/core';
import type { WorldView } from '@/sim/view';

/**
 * Второй пилот (раздел 6.2): приборы двигателей (наддув, обороты, температура головок,
 * топливомеры, гидросистема), органы запуска по шагам, флюгер и огнетушители, чек-листы,
 * «Взял управление».
 */
const props = defineProps<{ view: WorldView; checklists: Record<ChecklistId, string[]> }>();
const emit = defineEmits<{ act: [action: WorldAction] }>();
const { t } = useI18n();

const engines = computed(() => props.view.aircraft.engines);
const c = computed(() => props.view.copilot);
const set = (index: 0 | 1, field: keyof EngineControlsSet, value: number | boolean): void => emit('act', { type: 'engine', index, field, value });
const lists = computed(() => (Object.keys(props.checklists) as ChecklistId[]).map((id) => ({ id, items: props.checklists[id] })));
const hold = (index: 0 | 1, field: 'starter' | 'primer', value: boolean): void => set(index, field, value);
</script>

<template>
    <div class="pointer-events-auto absolute top-28 right-3 w-[30rem] space-y-2 rounded-md bg-black/70 p-3 text-xs" data-test="copilot-panel">
        <div class="grid grid-cols-2 gap-3">
            <div v-for="i in [0, 1] as const" :key="i" class="space-y-1 rounded border border-stone-700 p-2" :data-test="`engine-${i}`" :data-mode="engines[i].mode">
                <div class="flex justify-between font-semibold">
                    <span>{{ t(i === 0 ? 'copilot.engine_left' : 'copilot.engine_right') }}</span>
                    <span :class="engines[i].mode === 'running' ? 'text-emerald-300' : engines[i].mode === 'failed' ? 'text-red-400' : 'text-stone-400'">{{ t(`engine_mode.${engines[i].mode}`) }}</span>
                </div>
                <div class="grid grid-cols-3 gap-1 font-mono">
                    <span>MP {{ fixed(engines[i].manifoldInHg, 1) }}"</span>
                    <span>{{ fixed(engines[i].rpm) }} rpm</span>
                    <span :class="engines[i].chtC > 232 ? 'text-red-400' : ''">CHT {{ fixed(engines[i].chtC) }}°</span>
                </div>
                <div v-if="view.damage.engineFire[i]" class="font-semibold text-red-400">{{ t('copilot.fire') }}</div>
                <div class="flex flex-wrap gap-1">
                    <button class="rounded px-2 py-0.5" :class="c.magnetos[i] ? 'bg-emerald-700' : 'bg-stone-700'" @click="set(i, 'magnetos', !c.magnetos[i])">{{ t('copilot.magnetos') }}</button>
                    <button class="rounded bg-stone-700 px-2 py-0.5 active:bg-amber-600" @mousedown="hold(i, 'primer', true)" @mouseup="hold(i, 'primer', false)" @mouseleave="hold(i, 'primer', false)">{{ t('copilot.primer') }}</button>
                    <button class="rounded bg-stone-700 px-2 py-0.5 active:bg-amber-600" :data-test="`starter-${i}`" @mousedown="hold(i, 'starter', true)" @mouseup="hold(i, 'starter', false)" @mouseleave="hold(i, 'starter', false)">{{ t('copilot.starter') }}</button>
                    <button class="rounded px-2 py-0.5" :class="c.feather[i] ? 'bg-amber-700' : 'bg-stone-700'" @click="set(i, 'feather', !c.feather[i])">{{ t('copilot.feather') }}</button>
                    <button class="rounded px-2 py-0.5" :class="view.damage.extinguishers[i] ? 'bg-red-800' : 'bg-stone-800 text-stone-500'" :disabled="!view.damage.extinguishers[i]" @click="emit('act', { type: 'extinguish', index: i })">
                        {{ t('copilot.extinguisher') }}
                    </button>
                </div>
                <label class="flex items-center gap-2">{{ t('copilot.mixture') }}<input type="range" min="0" max="1" step="0.05" class="flex-1" :value="c.mixture[i]" @input="set(i, 'mixture', Number(($event.target as HTMLInputElement).value))" /></label>
                <label class="flex items-center gap-2">{{ t('copilot.prop') }}<input type="range" min="0" max="1" step="0.05" class="flex-1" :value="c.prop[i]" @input="set(i, 'prop', Number(($event.target as HTMLInputElement).value))" /></label>
                <label class="flex items-center gap-2">{{ t('copilot.cowl') }}<input type="range" min="0" max="1" step="0.1" class="flex-1" :value="c.cowl[i]" @input="set(i, 'cowl', Number(($event.target as HTMLInputElement).value))" /></label>
            </div>
        </div>

        <div class="flex flex-wrap items-center gap-2">
            <button class="rounded px-2 py-0.5" :class="c.battery ? 'bg-emerald-700' : 'bg-stone-700'" @click="emit('act', { type: 'battery', on: !c.battery })">{{ t('copilot.battery') }}</button>
            <button class="rounded px-2 py-0.5" :class="c.fuelPump ? 'bg-emerald-700' : 'bg-stone-700'" @click="emit('act', { type: 'fuel_pump', on: !c.fuelPump })">{{ t('copilot.fuel_pump') }}</button>
            <button class="rounded px-2 py-0.5" :class="view.crewFlags.oxygenOn ? 'bg-emerald-700' : 'bg-stone-700'" @click="emit('act', { type: 'oxygen', on: !view.crewFlags.oxygenOn })">{{ t('copilot.oxygen') }}</button>
            <button class="rounded bg-stone-700 px-2 py-0.5" @click="emit('act', { type: 'gear', down: !c.gearDown })">{{ c.gearDown ? t('training.gear_down') : t('training.gear_up') }} (G)</button>
            <span>{{ t('training.flaps') }} {{ fixed(c.flaps * 100) }}% (F)</span>
            <span class="font-mono">{{ t('copilot.hydraulics') }} {{ fixed(view.aircraft.hydraulicPressure * 100) }}%</span>
            <button v-if="view.flyingStation === 'pilot'" class="rounded bg-amber-700 px-2 py-0.5" @click="emit('act', { type: 'take_control' })">{{ t('copilot.take_control') }}</button>
        </div>

        <div v-if="view.orders.gearDown !== null && view.orders.gearDown !== c.gearDown" class="text-amber-300">{{ t(view.orders.gearDown ? 'intercom.order_gear_down' : 'intercom.order_gear_up') }}</div>

        <div class="font-mono">
            {{ t('copilot.fuel') }}:
            <span v-for="(kg, i) in view.aircraft.fuelKg" :key="i" class="mr-2">{{ fixed(kg / KG_PER_US_GAL) }} gal</span>
            <span v-if="view.damage.leakKgS > 0.05" class="text-red-400">{{ t('copilot.leak') }}</span>
        </div>

        <div class="grid grid-cols-2 gap-2" data-test="checklists">
            <div v-for="list in lists" :key="list.id">
                <div class="font-semibold">{{ t(`checklist.${list.id}`) }}</div>
                <button
                    v-for="item in list.items"
                    :key="item"
                    class="block w-full text-left"
                    :class="view.checklists[list.id][item] ? 'text-emerald-300' : 'text-stone-300 hover:text-white'"
                    @click="emit('act', { type: 'checklist', list: list.id, item })"
                >
                    {{ view.checklists[list.id][item] ? '☑' : '☐' }} {{ t(`checklist_item.${item}`) }}
                </button>
            </div>
        </div>
    </div>
</template>
