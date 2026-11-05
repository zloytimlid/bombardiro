<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from '@/composables/useI18n';
import { clockTime, deg, fixed, MS_TO_MPH } from '@/game/ui/format';
import type { WorldAction } from '@/sim/core';
import type { MissionStatic, WorldView } from '@/sim/view';

/**
 * Штурман (раздел 6.3): карта-планшет со счисленным местом, участки маршрута, расчётное время,
 * визир сноса (игрок совмещает нити с бегом земли), путевая скорость по секундомеру,
 * ветровой треугольник на расчётнике, отметки по ориентирам, радиокомпас.
 * Точное место на карте — только в «Учебном» режиме.
 */
const props = defineProps<{ view: WorldView; statics: MissionStatic }>();
const emit = defineEmits<{ act: [action: WorldAction] }>();
const { t } = useI18n();

const driftDeg = ref(0);
const gsMph = ref<number | null>(null);

const bounds = computed(() => {
    const xs = props.statics.waypoints.map((w) => w.position.x);
    const ys = props.statics.waypoints.map((w) => w.position.y);
    const pad = 8000;

    return { minX: Math.min(...xs) - pad, maxX: Math.max(...xs) + pad, minY: Math.min(...ys) - pad, maxY: Math.max(...ys) + pad };
});
const W = 420;
const H = computed(() => Math.round((W * (bounds.value.maxY - bounds.value.minY)) / (bounds.value.maxX - bounds.value.minX)));
const px = (x: number): number => ((x - bounds.value.minX) / (bounds.value.maxX - bounds.value.minX)) * W;
const py = (y: number): number => H.value - ((y - bounds.value.minY) / (bounds.value.maxY - bounds.value.minY)) * H.value;
const route = computed(() => props.statics.waypoints.map((w) => `${px(w.position.x)},${py(w.position.y)}`).join(' '));
const next = computed(() => props.statics.waypoints[props.view.nav.legIndex]);
const prev = computed(() => props.statics.waypoints[props.view.nav.legIndex - 1]);
const wind = computed(() => {
    const w = props.view.nav.windEst;
    const speed = Math.hypot(w.x, w.y);

    // Откуда дует: противоположно вектору.
    return { fromDeg: deg(Math.atan2(-w.x, -w.y)), speed };
});
const relativeBearing = computed(() => {
    const a = props.view.aircraft.position;
    const b = props.statics.beacon;

    return deg(Math.atan2(b.x - a.x, b.y - a.y));
});
// Секундомер по ориентиру: путевая скорость с ошибкой ±3 %.
const timeGroundSpeed = (): void => {
    gsMph.value = Math.round(props.view.nav.groundSpeedMs * MS_TO_MPH * (1 + (Math.random() - 0.5) * 0.06));
};
const solveWind = (): void => {
    if (gsMph.value === null) {
        timeGroundSpeed();
    }

    emit('act', { type: 'nav_drift', driftRad: (driftDeg.value * Math.PI) / 180, groundSpeedMs: (gsMph.value ?? 0) / MS_TO_MPH });
};
</script>

<template>
    <div class="pointer-events-auto absolute top-28 right-3 w-[27rem] space-y-2 rounded-md bg-[#d8cfb4]/95 p-3 text-xs text-stone-900" data-test="navigator-panel">
        <svg :width="W" :height="H" class="rounded bg-[#e8e0c8]" data-test="nav-map">
            <polyline :points="route" fill="none" stroke="#7c2d12" stroke-width="1.5" stroke-dasharray="4 3" />
            <g v-for="(w, i) in statics.waypoints" :key="w.id">
                <circle :cx="px(w.position.x)" :cy="py(w.position.y)" r="3" :fill="i === view.nav.legIndex ? '#b45309' : '#57534e'" />
                <text :x="px(w.position.x) + 4" :y="py(w.position.y) - 4" font-size="9">{{ w.id }}</text>
            </g>
            <rect :x="px(statics.target.aim.x) - 4" :y="py(statics.target.aim.y) - 4" width="8" height="8" fill="none" stroke="#991b1b" stroke-width="1.5" />
            <g v-for="l in statics.landmarks" :key="l.id">
                <polygon :points="`${px(l.position.x)},${py(l.position.y) - 5} ${px(l.position.x) + 4},${py(l.position.y) + 3} ${px(l.position.x) - 4},${py(l.position.y) + 3}`" fill="#1d4ed8" opacity="0.7" />
            </g>
            <!-- Счисленное место. -->
            <g :transform="`translate(${px(view.nav.dr.x)} ${py(view.nav.dr.y)}) rotate(${deg(view.derived.heading)})`" data-test="nav-dr">
                <polygon points="0,-7 4,5 -4,5" fill="#111" />
            </g>
            <circle v-if="view.nav.truePosition" :cx="px(view.nav.truePosition.x)" :cy="py(view.nav.truePosition.y)" r="4" fill="none" stroke="#16a34a" stroke-width="1.5" />
        </svg>

        <div class="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono">
            <span>{{ t('nav.leg') }}: {{ prev?.id ?? '—' }} → {{ next?.id ?? '—' }}</span>
            <span>{{ t('nav.course') }}: {{ view.nav.courseToSteer === null ? '—' : String(deg(view.nav.courseToSteer)).padStart(3, '0') }}°</span>
            <span>ETA {{ t('nav.target') }}: {{ clockTime(view.nav.etaS) }}</span>
            <span>TOT: {{ clockTime(statics.timeOverTargetS) }} ±1:00</span>
            <span>{{ t('nav.required_ias') }}: {{ view.nav.requiredIasMs === null ? '—' : fixed(view.nav.requiredIasMs * MS_TO_MPH) }} mph</span>
            <span>{{ t('nav.wind') }}: {{ String(wind.fromDeg).padStart(3, '0') }}° / {{ fixed(wind.speed * 1.944) }} kt</span>
            <span>{{ t('nav.radio_compass') }}: {{ String(relativeBearing).padStart(3, '0') }}°</span>
            <span>{{ t('nav.fixes', { count: view.nav.fixes }) }}</span>
        </div>

        <div class="space-y-1 rounded border border-stone-500 p-2" data-test="drift-meter">
            <div class="font-semibold">{{ t('nav.drift_meter') }}</div>
            <label class="flex items-center gap-2">
                {{ t('nav.drift') }}
                <input v-model.number="driftDeg" type="range" min="-20" max="20" step="0.5" class="flex-1" />
                <span class="w-12 text-right font-mono">{{ driftDeg.toFixed(1) }}°</span>
            </label>
            <p v-if="view.difficulty === 'training'" class="text-stone-600">{{ t('nav.drift_hint', { drift: ((view.nav.trueDrift * 180) / Math.PI).toFixed(1) }) }}</p>
            <div class="flex gap-2">
                <button class="rounded bg-stone-700 px-2 py-0.5 text-white" @click="timeGroundSpeed">{{ t('nav.time_gs') }}</button>
                <span class="font-mono">GS {{ gsMph ?? '—' }} mph</span>
                <button class="rounded bg-amber-800 px-2 py-0.5 text-white" data-test="solve-wind" @click="solveWind">{{ t('nav.solve_wind') }}</button>
            </div>
        </div>

        <div class="flex flex-wrap gap-1">
            <span>{{ t('nav.landmarks') }}:</span>
            <button v-for="id in view.nav.visibleLandmarks" :key="id" class="rounded bg-blue-800 px-2 py-0.5 text-white" @click="emit('act', { type: 'nav_fix', landmark: id })">{{ t('nav.fix') }} {{ id }}</button>
            <span v-if="view.nav.visibleLandmarks.length === 0" class="text-stone-600">{{ t('nav.no_landmarks') }}</span>
        </div>
    </div>
</template>
