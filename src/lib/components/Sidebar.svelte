<script>
    import { goto } from '$app/navigation';
    import { account } from '$lib/client'; 

    export let isSidebarOpen = true;
    export let currentPath = '/admin';

    const menuItems = [
        { name: 'Dashboard', icon: '🏠', path: '/admin' },
        { name: 'Reports', icon: '📊', path: '/admin/reports' },
        { name: 'Manage HR', icon: '🧑‍💼', path: '/admin/manage-hr' },
        { name: 'Manage Staff', icon: '👥', path: '/admin/manage-staff' },
        { name: 'Manage Receptionist', icon: '📞', path: '/admin/manage-receptionist' },
        { name: 'Dept & Position', icon: '🏢', path: '/admin/departments' },
        { name: 'Visitor List', icon: '📝', path: '/admin/visitors' },
        { name: 'Pre-bookings', icon: '🗓️', path: '/admin/prebookings' },
        { name: 'Settings', icon: '⚙️', path: '/admin/settings' },
        { name: 'Attendance', icon: '📋', path: '/admin/attendance' },
        { name: 'Ex-Staff', icon: '👥', path: '/admin/ex-staff' },
        { name: 'Profile', icon: '👤', path: '/admin/profile' },
        { name: 'Mail Report', icon: '📩', path: '/admin/checkout-monitor' },
        { name: 'Audit Log', icon: '🛡️', path: '/admin/audit' },
        { name: 'Session Management', icon: '🆔', path: '/admin/session-management' },
        
    ];

    function isActive(path) {
        // Simple check for active link
        return currentPath === path;
    }

    // Sign out and return to the login page
    async function handleLogout() {
        try {
            // End the current session
            await account.deleteSession('current');
            
            // Redirect the user to the login page after successful logout
            goto('/admin/login');
        } catch (error) {
            console.error('Logout failed:', error);
            // Fallback: leave the secured area even if the request fails
            // to ensure the user is taken out of the secured area.
            goto('/admin/login'); 
        }
    }
</script>

<aside class="flex flex-col h-screen bg-gray-800 text-white shadow-lg">
    <div class="text-2xl font-bold py-4 px-4 text-center">
        {#if isSidebarOpen}
            <span class="whitespace-nowrap">Admin Panel</span>
        {:else}
            <span>A</span>
        {/if}
    </div>

    <nav class="flex-1 overflow-y-auto px-4 space-y-2">
        {#each menuItems as item}
            <a
                href={item.path}
                class="flex items-center p-2 rounded-lg transition duration-200
                       {isActive(item.path) ? 'bg-indigo-600' : 'hover:bg-gray-700'}"
            >
                <span class="text-xl mr-3">{item.icon}</span>
                {#if isSidebarOpen}
                    <span class="font-medium whitespace-nowrap">{item.name}</span>
                {/if}
            </a>
        {/each}
    </nav>

    <div class="px-4 py-4 border-t border-gray-700 bg-gray-800">
        <button on:click={handleLogout} 
            class="w-full text-left flex items-center p-2 rounded-lg hover:bg-red-600 transition duration-200 focus:outline-none focus:ring-2 focus:ring-red-500"
        >
            <span class="text-xl mr-3">➡️</span>
            {#if isSidebarOpen}
                <span class="font-medium">Logout</span>
            {/if}
        </button>
    </div>
</aside>