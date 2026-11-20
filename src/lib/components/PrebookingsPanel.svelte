<script>
    // Shared by admin, HR and reception: upcoming pre-bookings with live updates.
    import { onMount, onDestroy } from 'svelte';
    import { realtime, VMS_DATABASE_ID, PREBOOKINGS_COLLECTION_ID, VISITOR_LOGS_COLLECTION_ID } from '$lib/client';

    const pad = (n) => String(n).padStart(2, '0');
    const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

    let mode = 'day'; // 'day' | 'upcoming'
    let date = today();
    let search = '';
    let bookings = [];
    let loading = true;
    let error = '';
    let unsubs = [];
    let reloadTimer;

    const STYLE = {
        booked: 'bg-blue-100 text-blue-700',
        'checked-in': 'bg-green-100 text-green-700',
        completed: 'bg-gray-100 text-gray-600',
        'no-show': 'bg-amber-100 text-amber-700',
        cancelled: 'bg-red-100 text-red-700'
    };

    async function load() {
        error = '';
        try {
            const res = await fetch('/api/prebooking', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(mode === 'day' ? { action: 'adminList', date } : { action: 'adminList', from: today() })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Failed to load bookings');
            bookings = data.bookings;
        } catch (e) {
            error = e.message;
        } finally {
            loading = false;
        }
    }

    function scheduleReload() {
        clearTimeout(reloadTimer);
        reloadTimer = setTimeout(load, 300);
    }

    async function cancel(b) {
        if (!confirm(`Cancel ${b.visitorName}'s booking at ${b.start}?`)) return;
        const res = await fetch('/api/prebooking', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'cancel', bookingId: b.id })
        });
        const data = await res.json();
        if (!res.ok) error = data.message;
        else load();
    }

    onMount(() => {
        load();
        for (const coll of [PREBOOKINGS_COLLECTION_ID, VISITOR_LOGS_COLLECTION_ID]) {
            unsubs.push(realtime.subscribe(`databases.${VMS_DATABASE_ID}.collections.${coll}.documents`, scheduleReload));
        }
    });
    onDestroy(() => { unsubs.forEach((u) => u && u()); clearTimeout(reloadTimer); });

    $: mode, date, load();
    $: shown = bookings.filter((b) => {
        const q = search.trim().toLowerCase();
        return !q || [b.visitorName, b.staffName, b.companyName, b.code, b.visitorPhone].some((v) => (v || '').toLowerCase().includes(q));
    });
    $: counts = shown.reduce((m, b) => ((m[b.state] = (m[b.state] || 0) + 1), m), {});
    const niceDate = (d) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
</script>

<div class="space-y-4">
    <div class="flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div class="inline-flex overflow-hidden rounded-lg border border-gray-300 text-sm">
            <button class="px-3 py-2 {mode === 'day' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-700'}" on:click={() => (mode = 'day')}>By day</button>
            <button class="px-3 py-2 {mode === 'upcoming' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-700'}" on:click={() => (mode = 'upcoming')}>All upcoming</button>
        </div>
        {#if mode === 'day'}
            <div>
                <label class="block text-xs font-medium text-gray-500" for="pb-date">Date</label>
                <input id="pb-date" type="date" bind:value={date} class="rounded-lg border border-gray-300 p-2 text-sm" />
            </div>
        {/if}
        <div class="min-w-[200px] flex-1">
            <label class="block text-xs font-medium text-gray-500" for="pb-search">Search</label>
            <input id="pb-search" bind:value={search} placeholder="Visitor, host, company, code…" class="w-full rounded-lg border border-gray-300 p-2 text-sm" />
        </div>
        <div class="flex gap-2 text-xs">
            {#each Object.entries(counts) as [state, n]}
                <span class="rounded-full px-2 py-1 font-semibold {STYLE[state] || 'bg-gray-100'}">{state}: {n}</span>
            {/each}
        </div>
    </div>

    {#if error}<p class="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>{/if}

    <div class="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
        <table class="min-w-full text-left text-sm">
            <thead class="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                    <th class="px-4 py-3">When</th>
                    <th class="px-4 py-3">Visitor</th>
                    <th class="px-4 py-3">Host</th>
                    <th class="px-4 py-3">Purpose</th>
                    <th class="px-4 py-3">Code</th>
                    <th class="px-4 py-3">Status</th>
                    <th class="px-4 py-3"></th>
                </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
                {#if loading}
                    <tr><td colspan="7" class="px-4 py-8 text-center text-gray-500">Loading…</td></tr>
                {:else if !shown.length}
                    <tr><td colspan="7" class="px-4 py-8 text-center text-gray-500">No bookings found.</td></tr>
                {/if}
                {#each shown as b (b.id)}
                    <tr class="hover:bg-gray-50">
                        <td class="whitespace-nowrap px-4 py-3 font-medium">{niceDate(b.date)}<br /><span class="text-gray-500">{b.start}–{b.end}</span></td>
                        <td class="px-4 py-3">{b.visitorName}<br /><span class="text-xs text-gray-500">{b.companyName} · {b.visitorPhone}</span></td>
                        <td class="px-4 py-3">{b.staffName}<br /><span class="text-xs text-gray-500">{b.departmentName || ''}</span></td>
                        <td class="max-w-[220px] truncate px-4 py-3" title={b.purpose}>{b.purpose}<span class="text-xs text-gray-500"> ({b.totalMembers})</span></td>
                        <td class="px-4 py-3 font-mono text-xs">{b.code}</td>
                        <td class="px-4 py-3"><span class="rounded-full px-2 py-1 text-xs font-semibold {STYLE[b.state] || 'bg-gray-100'}">{b.state}</span></td>
                        <td class="px-4 py-3 text-right">
                            {#if b.state === 'booked'}
                                <button class="text-red-600 underline" on:click={() => cancel(b)}>Cancel</button>
                            {/if}
                        </td>
                    </tr>
                {/each}
            </tbody>
        </table>
    </div>
</div>
