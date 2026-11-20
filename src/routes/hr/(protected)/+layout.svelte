<script>
    import { page } from '$app/stores';
    import { onMount } from 'svelte';
    import { goto } from '$app/navigation';
    import { account, databases, VMS_DATABASE_ID, STAFF_COLLECTION_ID, Query } from '$lib/client';
    import HRNavbar from '$lib/components/hr/HRNavbar.svelte';
    import HRSidebar from '$lib/components/hr/HRSidebar.svelte';

    let isSidebarOpen = true;
    let currentPath = '';
    let isLoading = true;
    let user = null;
    let staffData = null;
    let accessDenied = false;

    onMount(async () => {
        isLoading = true;
        accessDenied = false;

        try {
            user = await account.get();

            const staffResponse = await databases.listDocuments(
                VMS_DATABASE_ID,
                STAFF_COLLECTION_ID,
                [
                    Query.equal('email', user.email),
                    Query.equal('role', 'HR'),
                    Query.limit(1)
                ]
            );

            if (staffResponse.documents.length === 0) {
                console.warn('Access denied: User is not HR staff');
                accessDenied = true;
                
                setTimeout(async () => {
                    try {
                        await account.deleteSession('current');
                    } catch (e) {
                        console.error('Logout error:', e);
                    }
                    goto('/hr/login');
                }, 2000);
                return;
            }

            staffData = staffResponse.documents[0];
            console.log('HR access granted:', staffData.name);

        } catch (error) {
            console.warn('Not authenticated:', error);
            goto('/hr/login');
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
    <div class="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-50 to-indigo-100">
        <div class="text-center">
            <div class="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mb-4"></div>
            <p class="text-lg text-gray-700 font-medium">Loading HR Portal...</p>
        </div>
    </div>
{:else if accessDenied}
    <div class="min-h-screen flex items-center justify-center bg-gradient-to-br from-red-50 to-orange-100">
        <div class="bg-white p-8 rounded-xl shadow-2xl max-w-md text-center">
            <div class="mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 text-red-500 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
            </div>
            <h2 class="text-2xl font-bold text-gray-800 mb-2">Access Denied</h2>
            <p class="text-gray-600 mb-4">You do not have HR privileges to access this portal.</p>
            <p class="text-sm text-gray-500">Redirecting to login...</p>
        </div>
    </div>
{:else if user && staffData}
    <div class="flex h-screen bg-gray-50">
        {#if mobileOpen}
            <button type="button" class="fixed inset-0 z-30 bg-black/40 lg:hidden" aria-label="Close menu" on:click={() => (mobileOpen = false)}></button>
        {/if}
        <div class="fixed inset-y-0 left-0 z-40 w-64 transform transition-all duration-200 lg:static lg:z-auto lg:translate-x-0 {mobileOpen ? 'translate-x-0' : '-translate-x-full'} {isSidebarOpen ? 'lg:w-64' : 'lg:w-20'}">
            <HRSidebar isSidebarOpen={isSidebarOpen || !isDesktop} {currentPath} />
        </div>

        <div class="flex-1 flex flex-col overflow-hidden">
            <HRNavbar on:toggleSidebar={toggleSidebar} />

            <main class="flex-1 min-w-0 overflow-x-hidden overflow-y-auto p-3 sm:p-4 md:p-6">
                <slot />
            </main>
        </div>
    </div>
{/if}