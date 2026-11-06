<script setup lang="ts">
import { Form, Head } from '@inertiajs/vue3';
import InputError from '@/components/InputError.vue';
import PasswordInput from '@/components/PasswordInput.vue';
import TextLink from '@/components/TextLink.vue';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { useI18n } from '@/composables/useI18n';
import SocialLogin from '@/components/SocialLogin.vue';
import { login } from '@/routes';
import { store } from '@/routes/register';

const { t } = useI18n();

defineProps<{
    passwordRules: string;
}>();

defineOptions({
    layout: {
        title: 'ui.register_title',
        description: 'ui.register_description',
    },
});
</script>

<template>
    <Head :title="t('ui.register')" />

    <Form
        v-bind="store.form()"
        :reset-on-success="['password', 'password_confirmation']"
        v-slot="{ errors, processing }"
        class="flex flex-col gap-6"
    >
        <div class="grid gap-6">
            <div class="grid gap-2">
                <Label for="name">{{ t('ui.name') }}</Label>
                <Input
                    id="name"
                    type="text"
                    required
                    v-focus
                    :tabindex="1"
                    autocomplete="name"
                    name="name"
                    :placeholder="t('ui.full_name')"
                />
                <InputError :message="errors.name" />
            </div>

            <div class="grid gap-2">
                <Label for="email">{{ t('ui.email_address') }}</Label>
                <Input
                    id="email"
                    type="email"
                    required
                    :tabindex="2"
                    autocomplete="email"
                    name="email"
                    :placeholder="t('ui.email_placeholder')"
                />
                <InputError :message="errors.email" />
            </div>

            <div class="grid gap-2">
                <Label for="callsign">{{ t('auth.callsign') }}</Label>
                <Input
                    id="callsign"
                    type="text"
                    required
                    minlength="3"
                    maxlength="24"
                    pattern="[A-Za-z0-9_\-]+"
                    :tabindex="2"
                    autocomplete="nickname"
                    name="callsign"
                    :placeholder="t('ui.name_placeholder')"
                    :title="t('auth.callsign_hint')"
                />
                <p class="text-xs text-muted-foreground">
                    {{ t('auth.callsign_hint') }}
                </p>
                <InputError :message="errors.callsign" />
            </div>

            <div class="grid gap-2">
                <Label for="password">{{ t('ui.password') }}</Label>
                <PasswordInput
                    id="password"
                    required
                    :tabindex="3"
                    autocomplete="new-password"
                    name="password"
                    :placeholder="t('ui.password')"
                    :passwordrules="passwordRules"
                />
                <InputError :message="errors.password" />
            </div>

            <div class="grid gap-2">
                <Label for="password_confirmation">{{ t('ui.confirm_password') }}</Label>
                <PasswordInput
                    id="password_confirmation"
                    required
                    :tabindex="4"
                    autocomplete="new-password"
                    name="password_confirmation"
                    :placeholder="t('ui.confirm_password')"
                    :passwordrules="passwordRules"
                />
                <InputError :message="errors.password_confirmation" />
            </div>

            <Button
                type="submit"
                class="mt-2 w-full"
                tabindex="5"
                :disabled="processing"
                data-test="register-user-button"
            >
                <Spinner v-if="processing" />
                {{ t('ui.create_account') }}
            </Button>
        </div>

        <div class="text-center text-sm text-muted-foreground">
            {{ t('ui.have_account') }}
            <TextLink
                :href="login()"
                class="underline underline-offset-4"
                :tabindex="6"
                >{{ t('ui.log_in') }}</TextLink
            >
        </div>
    </Form>

    <SocialLogin class="mt-4" />
</template>
