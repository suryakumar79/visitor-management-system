<script>
    import PrebookingsPanel from '$lib/components/PrebookingsPanel.svelte';
</script>

<svelte:head><title>Pre-bookings - HR</title></svelte:head>

<div class="mx-auto max-w-6xl space-y-4">
    <div>
        <h1 class="text-2xl font-bold text-gray-800">Pre-bookings</h1>
        <p class="text-sm text-gray-500">Visitors who reserved a time slot with your colleagues.</p>
    </div>
    <PrebookingsPanel />
</div>
