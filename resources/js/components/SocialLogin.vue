<script setup lang="ts">
import { usePage } from '@inertiajs/vue3';
import { computed } from 'vue';
import { useI18n } from '@/composables/useI18n';

/** Вход через Discord / Google (этап 5): кнопки только для провайдеров с ключами в .env. */
const { t } = useI18n();
const page = usePage();
const providers = computed(() => (Array.isArray(page.props.socialProviders) ? (page.props.socialProviders as string[]) : []));
</script>

<template>
    <div v-if="providers.length > 0" class="space-y-2" data-test="social-login">
        <div class="text-center text-xs text-muted-foreground">{{ t('ui.or_continue_with') }}</div>
        <div class="flex gap-2">
            <!-- Обычная ссылка, не Inertia: дальше — редирект на сайт провайдера. -->
            <a
                v-for="p in providers"
                :key="p"
                :href="`/auth/${p}/redirect`"
                class="flex-1 rounded border px-3 py-2 text-center text-sm hover:bg-accent"
                :data-test="`social-${p}`"
            >
                {{ t(`ui.provider_${p}`) }}
            </a>
        </div>
    </div>
</template>
