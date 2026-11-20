<script>
    import { createEventDispatcher } from 'svelte';
    const dispatch = createEventDispatcher();

    function toggleSidebar() {
        dispatch('toggleSidebar');
    }
</script>

<header class="flex items-center justify-between h-16 bg-white shadow-md px-4">
    <button on:click={toggleSidebar} aria-label="Toggle menu" class="text-gray-600 hover:text-indigo-600 p-2 rounded-md">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
    </button>

    <a href="/admin/profile" class="flex items-center space-x-4 hover:opacity-80 transition cursor-pointer">
    <span class="text-sm font-medium text-gray-700 hidden sm:block">Admin User</span>
    <div class="w-10 h-10 rounded-full bg-indigo-500 flex items-center justify-center text-white font-bold">A</div>
</a>
</header>