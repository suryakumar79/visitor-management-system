<script>
    let email = '';
    let isLoading = false;
    let message = '';
    let isSuccess = false;

    async function handleSubmit() {
        if (!email.trim()) {
            message = 'Please enter your email address.';
            isSuccess = false;
            return;
        }
        isLoading = true;
        message = '';
        try {
            const response = await fetch('/api/admin/forgot-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });
            const data = await response.json();
            isSuccess = response.ok;
            message = response.ok ? data.message || 'If an admin account exists, a reset link has been sent.' : data.error || data.message || 'Could not send the reset link.';
            if (response.ok) email = '';
        } catch {
            message = 'An error occurred. Please try again later.';
            isSuccess = false;
        } finally {
            isLoading = false;
        }
    }
</script>

<svelte:head>
    <title>Forgot Password - Admin</title>
</svelte:head>

<div class="min-h-screen flex items-center justify-center bg-gray-100 p-4">
    <div class="w-full max-w-md bg-white rounded-lg shadow-md p-6 md:p-8">
        <h1 class="text-2xl font-bold text-center text-gray-800 mb-2">Forgot password</h1>
        <p class="text-sm text-gray-600 mb-6 text-center">Enter your admin email address and we will send you a reset link.</p>

        {#if message}
            <div class="mb-4 rounded-md p-3 text-sm break-words {isSuccess ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}" role="status">{message}</div>
        {/if}

        <form on:submit|preventDefault={handleSubmit} class="space-y-4">
            <div>
                <label for="email" class="block text-sm font-medium text-gray-700 mb-1">Email address</label>
                <input id="email" type="email" bind:value={email} required autocomplete="email" disabled={isLoading}
                    class="w-full rounded-md border border-gray-300 px-3 py-2 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <button type="submit" disabled={isLoading}
                class="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
                {isLoading ? 'Sending…' : 'Send reset link'}
            </button>
        </form>

        <div class="text-center mt-6">
            <a href="/admin/login" class="text-sm text-indigo-600 hover:underline">&larr; Back to login</a>
        </div>
    </div>
</div>
