<script>
    import { onMount } from 'svelte';
    import { goto } from '$app/navigation';
    import { account } from '$lib/client';
    import PrebookingsPanel from '$lib/components/PrebookingsPanel.svelte';

    let ready = false;

    onMount(async () => {
        try {
            const user = await account.get();
            if (!user.roles?.reception && !user.roles?.admin) throw new Error('not reception');
            ready = true;
        } catch {
            goto('/reception/login');
        }
    });
</script>

<svelte:head><title>Today's bookings - Reception</title></svelte:head>

<div class="min-h-screen bg-gray-50 p-4 sm:p-6">
    <div class="mx-auto max-w-6xl space-y-4">
        <div class="flex items-center justify-between">
            <div>
                <h1 class="text-2xl font-bold text-gray-800">Pre-bookings</h1>
                <p class="text-sm text-gray-500">Expected visitors. Scan their pass QR on the dashboard to check them in.</p>
            </div>
            <a href="/reception" class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">← Dashboard</a>
        </div>
        {#if ready}<PrebookingsPanel />{:else}<p class="text-gray-500">Checking session…</p>{/if}
    </div>
</div>
