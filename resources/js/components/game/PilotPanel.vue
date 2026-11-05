<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from '@/composables/useI18n';
import { deg, fixed, M_TO_FT, MS_TO_MPH } from '@/game/ui/format';
import type { WorldAction } from '@/sim/core';
import type { WorldView } from '@/sim/view';

/**
 * Пилот (раздел 6.1): дубли приборов в «Учебном» режиме, курс от штурмана, PDI на боевом курсе,
 * приказы экипажу по СПУ и подтверждение передачи управления.
 */
const props = defineProps<{ view: WorldView }>();
const emit = defineEmits<{ act: [action: WorldAction] }>();
const { t } = useI18n();

const d = computed(() => props.view.derived);
const pdi = computed(() => (props.view.sight.on ? (props.view.sight.readout?.pdi ?? 0) : null));
const order = (o: 'report_ready' | 'stations' | 'prepare_bailout' | 'bailout' | 'cancel_bailout'): void => emit('act', { type: 'order', order: o });
</script>

<template>
    <div
        v-if="view.difficulty === 'training'"
        class="pointer-events-none absolute top-[10rem] left-3 flex flex-wrap gap-x-4 gap-y-1 rounded-md bg-black/55 px-4 py-2 font-mono text-sm whitespace-nowrap"
        style="max-width: 46rem"
        data-test="flight-status"
        :data-contact="view.aircraft.contact"
    >
        <span>{{ t('training.ias') }} {{ fixed(d.indicatedAirspeed * MS_TO_MPH) }} mph</span>
        <span>{{ t('training.alt') }} {{ fixed(d.altitude * M_TO_FT) }} ft</span>
        <span>{{ t('training.vs') }} {{ fixed(d.verticalSpeed * M_TO_FT * 60) }} ft/min</span>
        <span>{{ t('training.hdg') }} {{ String(deg(d.heading)).padStart(3, '0') }}°</span>
        <span>{{ t('training.throttle') }} {{ fixed(view.pilotThrottle[0] * 100) }}/{{ fixed(view.pilotThrottle[1] * 100) }}%</span>
        <span>{{ view.aircraft.gear > 0.5 ? t('training.gear_down') : t('training.gear_up') }}</span>
        <span>{{ t('training.flaps') }} {{ fixed(view.aircraft.flaps * 100) }}%</span>
        <span v-if="view.nav.courseToSteer !== null">{{ t('pilot.course') }} {{ String(deg(view.nav.courseToSteer)).padStart(3, '0') }}°</span>
    </div>

    <!-- PDI: стрелка от прицела бомбардира. -->
    <div v-if="pdi !== null" class="pointer-events-none absolute top-1/3 left-1/2 w-64 -translate-x-1/2 rounded bg-black/60 p-2 text-center text-xs" data-test="pdi">
        <div class="mb-1">PDI</div>
        <div class="relative h-3 rounded bg-stone-700">
            <div class="absolute top-0 h-3 w-1 bg-amber-300" :style="{ left: `calc(${50 + Math.max(-1, Math.min(1, pdi / 0.15)) * 48}% - 2px)` }" />
            <div class="absolute top-0 left-1/2 h-3 w-px bg-white" />
        </div>
    </div>

    <div class="pointer-events-auto absolute right-3 bottom-44 flex w-52 flex-col gap-1 text-xs">
        <button v-if="view.crewFlags.takeControlRequested && view.flyingStation === 'pilot'" class="rounded bg-amber-600 px-2 py-1" @click="emit('act', { type: 'confirm_handover' })">
            {{ t('pilot.confirm_handover') }}
        </button>
        <button class="rounded bg-black/60 px-2 py-1 hover:bg-black/80" @click="order('report_ready')">{{ t('order.report_ready') }}</button>
        <button class="rounded bg-black/60 px-2 py-1 hover:bg-black/80" @click="order('stations')">{{ t('order.stations') }}</button>
        <button v-if="!view.crewFlags.prepareBailOut" class="rounded bg-black/60 px-2 py-1 hover:bg-black/80" @click="order('prepare_bailout')">{{ t('order.prepare_bailout') }}</button>
        <template v-else>
            <button class="rounded bg-red-800 px-2 py-1" data-test="order-bailout" @click="order('bailout')">{{ t('order.bailout') }}</button>
            <button class="rounded bg-black/60 px-2 py-1" @click="order('cancel_bailout')">{{ t('order.cancel_bailout') }}</button>
        </template>
    </div>
</template>
