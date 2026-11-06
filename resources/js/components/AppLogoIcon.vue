<script setup lang="ts">
import type { HTMLAttributes } from 'vue';

defineOptions({
    inheritAttrs: false,
});

type Props = {
    className?: HTMLAttributes['class'];
};

defineProps<Props>();
</script>

<template>
    <!-- Собственный значок: силуэт B-25 сверху (см. docs/assets.md). -->
    <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 100 100"
        :class="className"
        v-bind="$attrs"
    >
        <path
            fill="currentColor"
            d="M46 6 L54 6 L55 14 L55 84 L52 94 L48 94 L45 84 L45 14 Z M4 42 L45 36 L55 36 L96 42 L96 47 L55 48 L45 48 L4 47 Z M25 26 L31 26 L32 56 L24 56 Z M69 26 L75 26 L76 56 L68 56 Z M28 83 L72 83 L72 88 L28 88 Z M26 78 L31 78 L31 93 L26 93 Z M69 78 L74 78 L74 93 L69 93 Z"
        />
    </svg>
</template>
