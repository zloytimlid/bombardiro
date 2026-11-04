import { usePage } from '@inertiajs/vue3';
import { computed } from 'vue';
import type { Locale } from '@/lib/i18n';
import { fallbackLocale, isLocale, translate } from '@/lib/i18n';

export function useI18n() {
    const page = usePage();

    const locale = computed<Locale>(() => {
        const value: unknown = page.props.locale;

        return isLocale(value) ? value : fallbackLocale;
    });

    function t(key: string, params: Record<string, string | number> = {}): string {
        return translate(locale.value, key, params);
    }

    return { locale, t };
}
