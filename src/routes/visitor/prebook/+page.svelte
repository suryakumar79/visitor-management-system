<script>
    import { onMount } from 'svelte';
    import { page } from '$app/stores';
    import { goto } from '$app/navigation';
    import { get } from 'svelte/store';
    import { visitorService, sessionToken } from '$lib/visitorService';
    import { CalendarDays, Clock, User, CheckCircle, XCircle, ArrowLeft } from 'lucide-svelte';

    let visitorPhone = '';
    let departments = [];
    let staff = [];
    let config = null;

    let departmentId = '';
    let staffId = '';
    let date = '';
    let slots = [];
    let selectedSlot = '';
    let purpose = '';
    let totalMembers = 1;

    let loading = true;
    let loadingSlots = false;
    let submitting = false;
    let message = { text: '', type: '' };
    let confirmation = null;
    let myBookings = [];

    $: hosts = staff.filter((s) => !departmentId || s.departmentId === departmentId);
    $: selectedHost = staff.find((s) => s.id === staffId);

    const pad = (n) => String(n).padStart(2, '0');
    const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    $: minDate = fmt(new Date());
    $: maxDate = config ? fmt(new Date(Date.now() + config.daysAhead * 86400000)) : '';

    function setMessage(text, type = 'error') {
        message = { text, type };
        if (type === 'success') setTimeout(() => (message = { text: '', type: '' }), 6000);
    }

    async function api(action, extra = {}) {
        const res = await fetch('/api/prebooking', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action,
                visitorPhone,
                sessionToken: get(sessionToken)?.token,
                ...extra
            })
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 401 && data.needsLogin) {
            sessionStorage.removeItem('visitor_otp_session');
            goto('/visitor/login?next=prebook');
            throw new Error('Session expired');
        }
        if (!res.ok || data.success === false) throw new Error(data.message || 'Request failed');
        return data;
    }

    onMount(async () => {
        const sessionStr = sessionStorage.getItem('visitor_otp_session');
        if (!sessionStr || !get(sessionToken)) {
            goto('/visitor/login?next=prebook');
            return;
        }
        try {
            const session = JSON.parse(sessionStr);
            if (Date.now() >= session.expiresAt) throw new Error('expired');
            const urlPhone = $page.url.searchParams.get('phone');
            if (urlPhone && urlPhone !== session.phone) throw new Error('mismatch');
            visitorPhone = urlPhone || session.phone;
        } catch {
            sessionStorage.removeItem('visitor_otp_session');
            goto('/visitor/login?next=prebook');
            return;
        }

        try {
            const who = await visitorService.getVisitorData(visitorPhone);
            if (!who.success || !who.registered) {
                goto(`/visitor/register?phone=${encodeURIComponent(visitorPhone)}&next=prebook`);
                return;
            }
            const [dirData, cfg] = await Promise.all([visitorService.getCheckinData(visitorPhone), api('config')]);
            departments = dirData.departments || [];
            staff = (dirData.staff || []).filter((s) => !s.isOnLeave);
            config = cfg.config;
            await loadMine();
        } catch (e) {
            if (e.message !== 'Session expired') setMessage(e.message || 'Could not load the booking form');
        } finally {
            loading = false;
        }
    });

    async function loadMine() {
        try {
            myBookings = (await api('mine')).bookings;
        } catch { /* shown elsewhere */ }
    }

    async function loadSlots() {
        slots = [];
        selectedSlot = '';
        if (!staffId || !date) return;
        loadingSlots = true;
        try {
            slots = (await api('slots', { staffId, date })).slots;
            if (!slots.some((s) => s.available)) setMessage('No free slots on this day. Please try another date or host.');
            else message = { text: '', type: '' };
        } catch (e) {
            if (e.message !== 'Session expired') setMessage(e.message);
        } finally {
            loadingSlots = false;
        }
    }

    function onDeptChange() {
        if (!hosts.some((h) => h.id === staffId)) staffId = '';
        loadSlots();
    }

    async function submit() {
        if (!staffId || !date || !selectedSlot) return setMessage('Please choose a host, a date and a time slot.');
        if (purpose.trim().length < 3) return setMessage('Please tell us the purpose of your visit.');
        submitting = true;
        message = { text: '', type: '' };
        try {
            const res = await api('book', { staffId, date, start: selectedSlot, purpose: purpose.trim(), totalMembers: Number(totalMembers) || 1 });
            confirmation = res;
            await loadMine();
        } catch (e) {
            if (e.message !== 'Session expired') {
                setMessage(e.message);
                await loadSlots(); // slot list may have changed
            }
        } finally {
            submitting = false;
        }
    }

    async function cancelBooking(id) {
        if (!confirm('Cancel this booking?')) return;
        try {
            await api('cancel', { bookingId: id });
            setMessage('Booking cancelled.', 'success');
            await loadMine();
            if (staffId && date) await loadSlots();
        } catch (e) {
            setMessage(e.message);
        }
    }

    function again() {
        confirmation = null;
        selectedSlot = '';
        purpose = '';
        totalMembers = 1;
        loadSlots();
    }

    const niceDate = (d) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
</script>

<svelte:head>
    <title>Pre-book a Visit</title>
</svelte:head>

<div class="min-h-screen bg-gray-50 p-4 sm:p-6">
    <div class="mx-auto w-full max-w-3xl">
        <a href="/visitor/checkin?phone={encodeURIComponent(visitorPhone)}" class="mb-4 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
            <ArrowLeft class="h-4 w-4" /> Walk-in check-in instead
        </a>

        <div class="rounded-2xl border border-gray-100 bg-white p-6 shadow-xl sm:p-10">
            <div class="mb-8 flex flex-col items-center">
                <CalendarDays class="mb-3 h-10 w-10 text-indigo-600" />
                <h1 class="text-3xl font-bold tracking-tight text-gray-800">Pre-book a Visit</h1>
                <p class="mt-2 text-center text-gray-500">Pick your host and a time slot. Show your pass at reception when you arrive.</p>
            </div>

            {#if message.text}
                <div class="mb-6 rounded-lg border p-4 text-sm font-medium {message.type === 'success' ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-700'}" role="alert">
                    {message.text}
                </div>
            {/if}

            {#if loading}
                <p class="py-10 text-center text-gray-500">Loading…</p>
            {:else if confirmation}
                <div class="text-center" data-testid="booking-confirmation">
                    <CheckCircle class="mx-auto mb-3 h-14 w-14 text-green-600" />
                    <h2 class="text-2xl font-bold text-gray-800">You're booked!</h2>
                    <p class="mt-1 text-gray-500">Booking code</p>
                    <p class="my-2 text-3xl font-bold tracking-widest text-indigo-700">{confirmation.booking.code}</p>
                    <div class="mx-auto mt-4 max-w-sm rounded-xl bg-gray-50 p-4 text-left text-sm text-gray-700">
                        <p><strong>Host:</strong> {confirmation.booking.staffName}</p>
                        <p><strong>Date:</strong> {niceDate(confirmation.booking.date)}</p>
                        <p><strong>Time:</strong> {confirmation.booking.start} – {confirmation.booking.end}</p>
                        <p><strong>Purpose:</strong> {confirmation.booking.purpose}</p>
                    </div>
                    <p class="mt-4 text-xs text-gray-500">Please carry a photo ID. Your QR pass is ready.</p>
                    <div class="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
                        <a href={confirmation.passUrl} class="rounded-lg bg-indigo-600 px-5 py-3 font-medium text-white hover:bg-indigo-700">Open my pass</a>
                        <button on:click={again} class="rounded-lg border border-gray-300 px-5 py-3 font-medium text-gray-700 hover:bg-gray-50">Book another visit</button>
                    </div>
                </div>
            {:else}
                <form on:submit|preventDefault={submit} class="space-y-6">
                    <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div>
                            <label for="dept" class="mb-1 block text-sm font-medium text-gray-700">Department</label>
                            <select id="dept" bind:value={departmentId} on:change={onDeptChange} class="w-full rounded-lg border border-gray-300 p-3">
                                <option value="">All departments</option>
                                {#each departments as d}<option value={d.id}>{d.name}</option>{/each}
                            </select>
                        </div>
                        <div>
                            <label for="host" class="mb-1 block text-sm font-medium text-gray-700">Who are you meeting? *</label>
                            <select id="host" bind:value={staffId} on:change={loadSlots} required class="w-full rounded-lg border border-gray-300 p-3">
                                <option value="">Select a host</option>
                                {#each hosts as h}<option value={h.id}>{h.name}</option>{/each}
                            </select>
                        </div>
                    </div>

                    <div>
                        <label for="date" class="mb-1 block text-sm font-medium text-gray-700">Date *</label>
                        <input id="date" type="date" bind:value={date} on:change={loadSlots} min={minDate} max={maxDate} required class="w-full rounded-lg border border-gray-300 p-3 md:w-1/2" />
                        {#if config}
                            <p class="mt-1 text-xs text-gray-500">Open {config.open}–{config.close}, {config.slotMinutes}-minute slots, up to {config.daysAhead} days ahead.</p>
                        {/if}
                    </div>

                    {#if staffId && date}
                        <div>
                            <p class="mb-2 flex items-center gap-1 text-sm font-medium text-gray-700"><Clock class="h-4 w-4" /> Choose a time slot *</p>
                            {#if loadingSlots}
                                <p class="text-sm text-gray-500">Checking availability…</p>
                            {:else if slots.length}
                                <div class="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6" role="radiogroup" aria-label="Time slots">
                                    {#each slots as s}
                                        <button
                                            type="button"
                                            role="radio"
                                            aria-checked={selectedSlot === s.start}
                                            disabled={!s.available}
                                            title={s.reason || 'Available'}
                                            on:click={() => (selectedSlot = s.start)}
                                            class="rounded-lg border px-2 py-2 text-sm font-medium transition
                                                {selectedSlot === s.start ? 'border-indigo-600 bg-indigo-600 text-white' : s.available ? 'border-gray-300 bg-white text-gray-800 hover:border-indigo-400' : 'cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400 line-through'}"
                                        >
                                            {s.start}
                                        </button>
                                    {/each}
                                </div>
                            {/if}
                        </div>
                    {/if}

                    <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
                        <div class="md:col-span-2">
                            <label for="purpose" class="mb-1 block text-sm font-medium text-gray-700">Purpose of visit *</label>
                            <input id="purpose" bind:value={purpose} maxlength="200" required placeholder="e.g. Product demo, interview, delivery" class="w-full rounded-lg border border-gray-300 p-3" />
                        </div>
                        <div>
                            <label for="members" class="mb-1 block text-sm font-medium text-gray-700">People coming</label>
                            <input id="members" type="number" min="1" max="50" bind:value={totalMembers} class="w-full rounded-lg border border-gray-300 p-3" />
                        </div>
                    </div>

                    <button type="submit" disabled={submitting || !selectedSlot} class="w-full rounded-xl bg-indigo-600 py-3 font-bold text-white shadow-lg transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60">
                        {submitting ? 'Booking…' : selectedSlot ? `Confirm ${selectedSlot} on ${niceDate(date)}` : 'Select a slot to continue'}
                    </button>
                </form>
            {/if}

            {#if myBookings.length}
                <div class="mt-10 border-t pt-6">
                    <h3 class="mb-3 text-lg font-semibold text-gray-800">My bookings</h3>
                    <ul class="space-y-2">
                        {#each myBookings as b}
                            <li class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 p-3 text-sm">
                                <div>
                                    <p class="font-medium text-gray-800">{niceDate(b.date)} · {b.start}–{b.end}</p>
                                    <p class="text-gray-500">with {b.staffName} · <span class="font-mono">{b.code}</span></p>
                                </div>
                                <div class="flex items-center gap-3">
                                    <span class="rounded-full px-2 py-1 text-xs font-semibold {b.status === 'booked' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}">{b.status}</span>
                                    {#if b.status === 'booked'}
                                        <a href="/visitor/pass?logId={b.logId}" class="text-indigo-600 underline">Pass</a>
                                        <button on:click={() => cancelBooking(b.id)} class="text-red-600 underline">Cancel</button>
                                    {/if}
                                </div>
                            </li>
                        {/each}
                    </ul>
                </div>
            {/if}
        </div>
    </div>
</div>
