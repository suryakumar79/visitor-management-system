<script>
    import { onMount } from 'svelte';
    import { goto } from '$app/navigation';
    import { account } from '$lib/client';

    let userId = '';
    let secret = '';
    let password = '';
    let confirmPassword = '';
    let loading = false;
    let error = '';
    let success = false;

    onMount(() => {
        // Extract userId and secret from URL parameters
        const urlParams = new URLSearchParams(window.location.search);
        userId = urlParams.get('userId') || '';
        secret = urlParams.get('secret') || '';

        if (!userId || !secret) {
            error = 'Invalid reset link. Please request a new password reset.';
        }
    });

    async function handlePasswordReset() {
        error = '';

        // Validate inputs
        if (!password || !confirmPassword) {
            error = 'Please fill in all fields';
            return;
        }

        if (password.length < 8) {
            error = 'Password must be at least 8 characters long';
            return;
        }

        if (password !== confirmPassword) {
            error = 'Passwords do not match';
            return;
        }

        loading = true;

        try {
            // Complete the password recovery
            await account.updateRecovery(userId, secret, password);

            success = true;

            // Redirect to login after 3 seconds
            setTimeout(() => {
                goto('/hr/login');
            }, 3000);
        } catch (e) {
            console.error('Password reset error:', e);
            if (e.code === 401) {
                error = 'Reset link has expired or is invalid. Please request a new one.';
            } else {
                error = 'Failed to reset password. Please try again.';
            }
        } finally {
            loading = false;
        }
    }
</script>

<svelte:head>
    <title>Reset Password - HR Portal</title>
</svelte:head>

<div class="min-h-screen bg-gradient-to-br from-purple-50 to-indigo-100 flex items-center justify-center p-4">
    <div class="max-w-md w-full">
        <!-- Logo/Header -->
        <div class="text-center mb-8">
            <div class="inline-block p-4 bg-purple-600 rounded-full mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
            </div>
            <h1 class="text-3xl font-bold text-gray-800">Reset Password</h1>
            <p class="text-gray-600 mt-2">Enter your new password</p>
        </div>

        <!-- Reset Card -->
        <div class="bg-white rounded-xl shadow-2xl p-8">
            {#if success}
                <!-- Success Message -->
                <div class="text-center">
                    <div class="mb-4">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 text-green-500 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                    </div>
                    <h2 class="text-2xl font-semibold text-gray-800 mb-4">Password Reset Successfully!</h2>
                    <p class="text-gray-600 mb-6">
                        Your password has been updated. Redirecting to login...
                    </p>
                    <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto"></div>
                </div>
            {:else}
                <h2 class="text-2xl font-semibold text-gray-800 mb-6">Create New Password</h2>

                <!-- Error Message -->
                {#if error}
                    <div class="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                        <p class="text-sm text-red-600">{error}</p>
                    </div>
                {/if}

                <form on:submit|preventDefault={handlePasswordReset} class="space-y-5">
                    <!-- New Password -->
                    <div>
                        <label for="password" class="block text-sm font-medium text-gray-700 mb-2">
                            New Password
                        </label>
                        <input
                            id="password"
                            type="password"
                            bind:value={password}
                            disabled={loading || !userId || !secret}
                            placeholder="Enter new password"
                            class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent transition"
                            required
                            minlength="8"
                        />
                        <p class="text-xs text-gray-500 mt-1">Minimum 8 characters</p>
                    </div>

                    <!-- Confirm Password -->
                    <div>
                        <label for="confirmPassword" class="block text-sm font-medium text-gray-700 mb-2">
                            Confirm Password
                        </label>
                        <input
                            id="confirmPassword"
                            type="password"
                            bind:value={confirmPassword}
                            disabled={loading || !userId || !secret}
                            placeholder="Confirm new password"
                            class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent transition"
                            required
                        />
                    </div>

                    <!-- Submit Button -->
                    <button
                        type="submit"
                        disabled={loading || !userId || !secret}
                        class="w-full py-3 bg-purple-600 text-white font-semibold rounded-lg hover:bg-purple-700 transition duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                    >
                        {#if loading}
                            <svg class="animate-spin h-5 w-5 mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            Resetting Password...
                        {:else}
                            Reset Password
                        {/if}
                    </button>

                    <!-- Back Link -->
                    <div class="text-center">
                        <a
                            href="/hr/login"
                            class="text-sm text-purple-600 hover:text-purple-800 font-medium"
                        >
                            Back to Login
                        </a>
                    </div>
                </form>
            {/if}
        </div>
    </div>
</div>