<!-- src/routes/admin/reset-password/+page.svelte -->
<script>
    import { goto } from '$app/navigation';
    import { page } from '$app/stores';
    import { onMount } from 'svelte';
    
    let password = '';
    let confirmPassword = '';
    let isLoading = false;
    let message = '';
    let isSuccess = false;
    let token = '';
    let isValidLink = false;

    onMount(() => {
        token = $page.url.searchParams.get('token') || '';

        if (!token) {
            message = 'Invalid or expired reset link. Please request a new one.';
            isSuccess = false;
            isValidLink = false;
        } else {
            isValidLink = true;
        }
    });

    async function handlePasswordReset() {
        // Validation
        if (!password || !confirmPassword) {
            message = 'Please fill in all fields.';
            isSuccess = false;
            return;
        }

        if (password !== confirmPassword) {
            message = 'Passwords do not match.';
            isSuccess = false;
            return;
        }

        if (password.length < 8) {
            message = 'Password must be at least 8 characters long.';
            isSuccess = false;
            return;
        }

        isLoading = true;
        message = '';

        try {
            const response = await fetch('/api/admin/reset-password', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ 
                    token, 
                    password 
                })
            });

            const data = await response.json();

            if (response.ok) {
                message = 'Password reset successfully! Redirecting to login...';
                isSuccess = true;
                
                password = '';
                confirmPassword = '';
                
                setTimeout(() => {
                    goto('/admin/login');
                }, 2000);
            } else {
                message = data.error || 'Failed to reset password. Please try again.';
                isSuccess = false;
            }

        } catch (error) {
            message = 'An error occurred. Please try again later.';
            isSuccess = false;
        } finally {
            isLoading = false;
        }
    }
</script>

<svelte:head>
    <title>Reset Password - Admin Portal</title>
</svelte:head>

<div class="min-h-screen flex items-center justify-center bg-gray-100 p-4">
    <div class="w-full max-w-md bg-white rounded-lg shadow-md p-6 md:p-8">
        <h2 class="text-2xl font-bold text-center text-gray-800 mb-6">Reset Password</h2>

        <p class="text-sm text-gray-600 mb-6 text-center">
            Enter your new password below.
        </p>

        <!-- Show messages -->
        {#if message}
            <div class="{isSuccess ? 'bg-green-100 border-green-400 text-green-700' : 'bg-red-100 border-red-400 text-red-700'} px-4 py-3 rounded-md mb-4" role="alert">
                <span class="block sm:inline">{message}</span>
            </div>
        {/if}

        {#if isValidLink}
            <form on:submit|preventDefault={handlePasswordReset}>
                <div class="mb-4">
                    <label for="password" class="block text-sm font-medium text-gray-700 mb-2">
                        New Password
                    </label>
                    <input
                        type="password"
                        id="password"
                        bind:value={password}
                        class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                        placeholder="••••••••"
                        disabled={isLoading}
                        required
                        minlength="8"
                    />
                    <p class="mt-1 text-xs text-gray-500">Must be at least 8 characters long</p>
                </div>

                <div class="mb-6">
                    <label for="confirmPassword" class="block text-sm font-medium text-gray-700 mb-2">
                        Confirm Password
                    </label>
                    <input
                        type="password"
                        id="confirmPassword"
                        bind:value={confirmPassword}
                        class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                        placeholder="••••••••"
                        disabled={isLoading}
                        required
                        minlength="8"
                    />
                </div>

                <div class="mt-6">
                    <button
                        type="submit"
                        class="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 {isLoading ? 'opacity-50 cursor-not-allowed' : ''}"
                        disabled={isLoading}
                    >
                        {isLoading ? 'Resetting Password...' : 'Reset Password'}
                    </button>
                </div>
            </form>
        {:else}
            <div class="text-center">
                <p class="text-sm text-gray-600 mb-4">
                    The reset link is invalid or has expired.
                </p>
                <a 
                    href="/admin/forgot-password" 
                    class="inline-block px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition"
                >
                    Request New Reset Link
                </a>
            </div>
        {/if}

        <div class="text-center mt-6">
            <a href="/admin/login" class="text-sm text-indigo-600 hover:underline">
                &larr; Back to Login
            </a>
        </div>
    </div>
</div>