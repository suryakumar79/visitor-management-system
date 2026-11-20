<script>
    import { APP_NAME, ORG_NAME } from '$lib/brand.js';
</script>

<svelte:head>
    <title>{APP_NAME}</title>
</svelte:head>

<div class="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-50 p-4 sm:p-8">
    <div class="mx-auto max-w-4xl">
        <div class="mb-10 mt-6 text-center">
            <img src="/logo.svg" alt="" class="mx-auto mb-4 h-14 w-14" />
            <h1 class="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">{APP_NAME}</h1>{#if ORG_NAME}<p class="mt-1 text-lg font-medium text-gray-700">{ORG_NAME}</p>{/if}
            <p class="mt-2 text-gray-600">Welcome. Please choose how you would like to continue.</p>
        </div>

        <h2 class="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Visitors</h2>
        <div class="mb-10 grid gap-4 sm:grid-cols-2">
            <a href="/visitor/login" class="group rounded-2xl border border-gray-200 bg-white p-6 shadow-sm transition hover:border-indigo-400 hover:shadow-md">
                <div class="mb-2 text-3xl">🚪</div>
                <h3 class="text-lg font-semibold text-gray-900 group-hover:text-indigo-700">I'm here now</h3>
                <p class="mt-1 text-sm text-gray-600">Walk-in check-in. Verify your phone, take a selfie and request your host's approval.</p>
            </a>
            <a href="/visitor/login?next=prebook" class="group rounded-2xl border border-gray-200 bg-white p-6 shadow-sm transition hover:border-indigo-400 hover:shadow-md">
                <div class="mb-2 text-3xl">🗓️</div>
                <h3 class="text-lg font-semibold text-gray-900 group-hover:text-indigo-700">Pre-book a visit</h3>
                <p class="mt-1 text-sm text-gray-600">Reserve a time slot with your host and get a QR pass for a faster check-in.</p>
            </a>
        </div>

        <h2 class="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Staff portals</h2>
        <div class="grid gap-4 sm:grid-cols-3">
            <a href="/admin/login" class="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition hover:border-gray-400 hover:shadow-md">
                <div class="mb-1 text-2xl">🛡️</div>
                <h3 class="font-semibold text-gray-900">Admin</h3>
                <p class="mt-1 text-xs text-gray-500">Reports, staff, settings and sessions</p>
            </a>
            <a href="/hr/login" class="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition hover:border-gray-400 hover:shadow-md">
                <div class="mb-1 text-2xl">🧑‍💼</div>
                <h3 class="font-semibold text-gray-900">HR</h3>
                <p class="mt-1 text-xs text-gray-500">Staff, attendance and departments</p>
            </a>
            <a href="/reception/login" class="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition hover:border-gray-400 hover:shadow-md">
                <div class="mb-1 text-2xl">📞</div>
                <h3 class="font-semibold text-gray-900">Reception</h3>
                <p class="mt-1 text-xs text-gray-500">Scan passes, check visitors in and out</p>
            </a>
        </div>
    </div>
</div>
