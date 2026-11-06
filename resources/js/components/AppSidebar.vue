<script setup lang="ts">
import { Link } from '@inertiajs/vue3';
import { Info, LayoutGrid, Map, Medal, Warehouse } from '@lucide/vue';
import { computed } from 'vue';
import AppLogo from '@/components/AppLogo.vue';
import NavFooter from '@/components/NavFooter.vue';
import NavMain from '@/components/NavMain.vue';
import NavUser from '@/components/NavUser.vue';
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
} from '@/components/ui/sidebar';
import { dashboard } from '@/routes';
import { useI18n } from '@/composables/useI18n';
import type { NavItem } from '@/types';

const { t } = useI18n();

const mainNavItems = computed<NavItem[]>(() => [
    { title: t('appnav.dashboard'), href: dashboard(), icon: LayoutGrid },
    { title: t('appnav.missions'), href: '/missions', icon: Map },
    { title: t('appnav.hangar'), href: '/hangar', icon: Warehouse },
    { title: t('appnav.leaderboards'), href: '/leaderboards', icon: Medal },
]);

const footerNavItems = computed<NavItem[]>(() => [{ title: t('appnav.about'), href: '/about', icon: Info }]);
</script>

<template>
    <Sidebar collapsible="icon" variant="inset">
        <SidebarHeader>
            <SidebarMenu>
                <SidebarMenuItem>
                    <SidebarMenuButton size="lg" as-child>
                        <Link :href="dashboard()">
                            <AppLogo />
                        </Link>
                    </SidebarMenuButton>
                </SidebarMenuItem>
            </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
            <NavMain :items="mainNavItems" />
        </SidebarContent>

        <SidebarFooter>
            <NavFooter :items="footerNavItems" />
            <NavUser />
        </SidebarFooter>
    </Sidebar>
    <slot />
</template>
