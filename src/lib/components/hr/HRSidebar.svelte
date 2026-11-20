<script>
    import { goto } from '$app/navigation';
    import { account } from '$lib/client';

    export let isSidebarOpen = true;
    export let currentPath = '/hr';

    const menuItems = [
        { name: 'Dashboard', icon: '🏠', path: '/hr' },
        { name: 'Manage Staff', icon: '👥', path: '/hr/staff' },
        { name: 'Pre-bookings', icon: '🗓️', path: '/hr/prebookings' },
        { name: 'Attendance', icon: '📋', path: '/hr/attendance' },
        { name: 'Dept & Position', icon: '🏢', path: '/hr/departments' },
        { name: 'Ex-Staff', icon: '👥', path: '/hr/ex-staff' },
        { name: 'Profile', icon: '👤', path: '/hr/profile' },
    ];

    function isActive(path) {
        return currentPath === path;
    }

    async function handleLogout() {
        try {
            await account.deleteSession('current');
            goto('/hr/login');
        } catch (error) {
            console.error('Logout failed:', error);
            goto('/hr/login');
        }
    }
</script>

<aside class="flex flex-col h-full bg-gradient-to-b from-purple-800 to-indigo-900 text-white shadow-lg p-4">
    <div class="text-2xl font-bold mb-8 text-center overflow-hidden whitespace-nowrap">
        {isSidebarOpen ? 'HR Portal' : 'HR'}
    </div>

    <nav class="flex-1 space-y-2">
        {#each menuItems as item}
            <a
                href={item.path}
                class="flex items-center p-3 rounded-lg transition duration-200
                       {isActive(item.path) ? 'bg-purple-600 shadow-md' : 'hover:bg-purple-700'}"
            >
                <span class="text-xl mr-3">{item.icon}</span>
                {#if isSidebarOpen}
                    <span class="font-medium whitespace-nowrap">{item.name}</span>
                {/if}
            </a>
        {/each}
    </nav>

    <div class="mt-8 pt-4 border-t border-purple-700">
        <button 
            on:click={handleLogout} 
            class="w-full text-left flex items-center p-3 rounded-lg hover:bg-red-600 transition duration-200 focus:outline-none focus:ring-2 focus:ring-red-500"
        >
            <span class="text-xl mr-3">🚪</span>
            {#if isSidebarOpen}
                <span class="font-medium">Logout</span>
            {/if}
        </button>
    </div>
</aside>