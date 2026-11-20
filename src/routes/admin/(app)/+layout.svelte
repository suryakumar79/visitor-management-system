<script>
    import { page } from '$app/stores';
    import { onMount } from 'svelte';
    import { goto } from '$app/navigation';
    import { account } from '$lib/client';
    import Navbar from '$lib/components/Navbar.svelte';
    import Sidebar from '$lib/components/Sidebar.svelte';

    let isSidebarOpen = true;
    let currentPath = '';
    let isLoading = true;
    let user = null;

    // ✅ Check authentication AND admin role on mount
    onMount(async () => {
        isLoading = true;
        try {
            user = await account.get();
            
            // ✅ Verify user has admin privileges
            if (!user.labels || !user.labels.includes('admin')) {
                console.warn('User is not an admin. Redirecting to login.');
                await account.deleteSession('current'); // Log them out
                goto('/admin/login');
                return;
            }
            
            console.log('✅ Admin verified');
            
        } catch (error) {
            console.warn('Not authenticated. Redirecting to login.');
            goto('/admin/login');
        } finally {
            isLoading = false;
        }
    });

    $: currentPath = $page.url.pathname;

    
    // Responsive shell: a slide-in drawer below 1024px, a collapsible sidebar above it
    let mobileOpen = false;
    let isDesktop = true;
    onMount(() => {
        const mq = window.matchMedia('(min-width: 1024px)');
        const apply = () => { isDesktop = mq.matches; if (isDesktop) mobileOpen = false; };
        apply();
        mq.addEventListener('change', apply);
        return () => mq.removeEventListener('change', apply);
    });
    $: if (currentPath) mobileOpen = false;

    function toggleSidebar() {
        if (isDesktop) isSidebarOpen = !isSidebarOpen;
        else mobileOpen = !mobileOpen;
    }
</script>

{#if isLoading}
    <div class="min-h-screen flex items-center justify-center">
        <p class="text-lg text-gray-600">Loading Admin Panel...</p>
    </div>
{:else if user}
    <div class="flex h-screen bg-gray-50">
        {#if mobileOpen}
            <button type="button" class="fixed inset-0 z-30 bg-black/40 lg:hidden" aria-label="Close menu" on:click={() => (mobileOpen = false)}></button>
        {/if}
        <div class="fixed inset-y-0 left-0 z-40 w-64 transform transition-all duration-200 lg:static lg:z-auto lg:translate-x-0 {mobileOpen ? 'translate-x-0' : '-translate-x-full'} {isSidebarOpen ? 'lg:w-64' : 'lg:w-20'}">
            <Sidebar isSidebarOpen={isSidebarOpen || !isDesktop} {currentPath} />
        </div>

        <div class="flex-1 flex flex-col overflow-hidden">
            <Navbar on:toggleSidebar={toggleSidebar} />

            <main class="flex-1 min-w-0 overflow-x-hidden overflow-y-auto p-3 sm:p-4 md:p-6">
                <slot />
            </main>
        </div>
    </div>
{/if}