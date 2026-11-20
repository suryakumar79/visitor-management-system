<script>
    import { onMount } from 'svelte';

    let entries = [];
    let total = 0;
    let loading = true;
    let error = '';
    let filter = '';

    async function load() {
        loading = true;
        error = '';
        try {
            const res = await fetch('/api/admin/audit?limit=300');
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Failed to load the audit log');
            entries = data.entries;
            total = data.total;
        } catch (e) {
            error = e.message;
        } finally {
            loading = false;
        }
    }
    onMount(load);

    $: shown = entries.filter((e) => !filter || `${e.action} ${e.actor} ${e.target} ${e.ip}`.toLowerCase().includes(filter.toLowerCase()));
    const bad = (a) => /failed|blocked|terminated|removed|deleted/.test(a);
</script>

<svelte:head><title>Audit log - Admin</title></svelte:head>

<div class="mx-auto max-w-6xl space-y-4">
    <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
            <h1 class="text-2xl font-bold text-gray-800">Audit log</h1>
            <p class="text-sm text-gray-500">Sign-ins, password changes and account actions. {total} entries in total.</p>
        </div>
        <div class="flex gap-2">
            <input bind:value={filter} placeholder="Filter…" class="rounded-lg border border-gray-300 p-2 text-sm" aria-label="Filter the audit log" />
            <button on:click={load} class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">Refresh</button>
        </div>
    </div>

    {#if error}<p class="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>{/if}

    <div class="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
        <table class="min-w-full text-left text-sm">
            <thead class="bg-gray-50 text-xs uppercase text-gray-500">
                <tr><th class="px-4 py-3">Time</th><th class="px-4 py-3">Action</th><th class="px-4 py-3">Who</th><th class="px-4 py-3">Target</th><th class="px-4 py-3">IP</th></tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
                {#if loading}
                    <tr><td colspan="5" class="px-4 py-8 text-center text-gray-500">Loading…</td></tr>
                {:else if !shown.length}
                    <tr><td colspan="5" class="px-4 py-8 text-center text-gray-500">Nothing to show.</td></tr>
                {/if}
                {#each shown as e (e.id)}
                    <tr class="hover:bg-gray-50">
                        <td class="whitespace-nowrap px-4 py-2 text-gray-500">{new Date(e.at).toLocaleString()}</td>
                        <td class="px-4 py-2"><span class="rounded-full px-2 py-1 text-xs font-semibold {bad(e.action) ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'}">{e.action}</span></td>
                        <td class="px-4 py-2">{e.actor}</td>
                        <td class="max-w-[220px] truncate px-4 py-2" title={e.target}>{e.target}</td>
                        <td class="px-4 py-2 font-mono text-xs text-gray-500">{e.ip}</td>
                    </tr>
                {/each}
            </tbody>
        </table>
    </div>
</div>
