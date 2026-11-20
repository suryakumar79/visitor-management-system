<script>
    import { createEventDispatcher } from 'svelte';
    import { onMount } from 'svelte';
    import { account, databases, VMS_DATABASE_ID, STAFF_COLLECTION_ID, Query } from '$lib/client';

    const dispatch = createEventDispatcher();

    let userName = 'HR User';
    let userEmail = '';
    let staffInfo = null;
    let showProfileMenu = false;

    onMount(async () => {
        try {
            const user = await account.get();
            userEmail = user.email;

            // Try to find staff info from the Staff collection
            const staffResponse = await databases.listDocuments(
                VMS_DATABASE_ID,
                STAFF_COLLECTION_ID,
                [Query.equal('email', user.email), Query.limit(1)]
            );

            if (staffResponse.documents.length > 0) {
                staffInfo = staffResponse.documents[0];
                userName = staffInfo.name;
            }
        } catch (error) {
            console.error('Failed to load user info:', error);
        }
    });

    function toggleSidebar() {
        dispatch('toggleSidebar');
    }

    function toggleProfileMenu() {
        showProfileMenu = !showProfileMenu;
    }

    // Close profile menu when clicking outside
    function handleClickOutside(event) {
        if (showProfileMenu && !event.target.closest('.profile-menu-container')) {
            showProfileMenu = false;
        }
    }
</script>

<svelte:window on:click={handleClickOutside} />

<header class="flex items-center justify-between h-16 bg-white shadow-md px-4 relative">
    <button 
        on:click={toggleSidebar} 
        class="text-gray-600 hover:text-purple-600 p-2 rounded-md transition"
        aria-label="Toggle sidebar"
    >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
    </button>

    <div class="flex-1 px-4">
        <h1 class="text-lg font-semibold text-gray-800">Human Resources Portal</h1>
    </div>

    <div class="flex items-center space-x-4 relative">
        <!-- Notifications (placeholder for future) -->
        <button class="p-2 text-gray-600 hover:text-purple-600 rounded-md relative">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
        </button>

        <!-- Profile Menu -->
        <div class="relative profile-menu-container">
            <button 
                on:click|stopPropagation={toggleProfileMenu}
                class="flex items-center space-x-2 focus:outline-none"
            >
                <span class="text-sm font-medium text-gray-700 hidden sm:block">{userName}</span>
                <div class="w-10 h-10 rounded-full bg-gradient-to-r from-purple-500 to-indigo-600 flex items-center justify-center text-white font-bold shadow-md">
                    {userName.charAt(0).toUpperCase()}
                </div>
            </button>

            {#if showProfileMenu}
                <div class="absolute right-0 mt-2 w-64 bg-white rounded-lg shadow-xl border border-gray-200 py-2 z-50">
                    <div class="px-4 py-3 border-b border-gray-200">
                        <p class="text-sm font-semibold text-gray-800">{userName}</p>
                        <p class="text-xs text-gray-500">{userEmail}</p>
                        <span class="inline-block mt-2 px-2 py-1 bg-purple-100 text-purple-800 text-xs font-medium rounded">
                            HR Staff
                        </span>
                    </div>
                    {#if staffInfo}
                        <div class="px-4 py-2 border-b border-gray-200">
                            <p class="text-xs text-gray-500">Employee Code</p>
                            <p class="text-sm text-gray-800">{staffInfo.employeeCode || 'N/A'}</p>
                        </div>
                    {/if}
                    <a href="/hr/profile" class="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">
                        My Profile
                    </a>
                    <button 
                        on:click={() => showProfileMenu = false}
                        class="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                        Close
                    </button>
                </div>
            {/if}
        </div>
    </div>
</header>