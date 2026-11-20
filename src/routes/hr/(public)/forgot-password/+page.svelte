<script>
    import { goto } from '$app/navigation';
    import { account } from '$lib/client';

    let email = '';
    let loading = false;
    let error = '';
    let success = false;

    async function handleResetRequest() {
        if (!email) {
            error = 'Please enter your email address';
            return;
        }

        loading = true;
        error = '';
        success = false;

        try {
            // Create password recovery request
            // The reset URL should point to your HR portal reset page
            await account.createRecovery(
                email,
                `${window.location.origin}/hr/reset-password`
            );

            success = true;
        } catch (e) {
            console.error('Password reset error:', e);
            if (e.code === 404) {
                error = 'No account found with this email address';
            } else {
                error = 'Failed to send reset email. Please try again.';
            }
        } finally {
            loading = false;
        }
    }

    function goBack() {
        goto('/hr/login');
    }
</script>

<svelte:head>
    <title>Forgot Password - HR Portal</title>
</svelte:head>

<div class="min-h-screen bg-gradient-to-br from-purple-50 to-indigo-100 flex items-center justify-center p-4">
    <div class="max-w-md w-full">
        <!-- Logo/Header -->
        <div class="text-center mb-8">
            <div class="inline-block p-4 bg-purple-600 rounded-full mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                </svg>
            </div>
            <h1 class="text-3xl font-bold text-gray-800">Forgot Password</h1>
            <p class="text-gray-600 mt-2">Reset your HR Portal password</p>
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
                    <h2 class="text-2xl font-semibold text-gray-800 mb-4">Check Your Email</h2>
                    <p class="text-gray-600 mb-6">
                        We've sent password reset instructions to <strong>{email}</strong>
                    </p>
                    <p class="text-sm text-gray-500 mb-6">
                        Didn't receive the email? Check your spam folder or try again.
                    </p>
                    <button
                        on:click={goBack}
                        class="w-full py-3 bg-purple-600 text-white font-semibold rounded-lg hover:bg-purple-700 transition duration-200"
                    >
                        Back to Login
                    </button>
                </div>
            {:else}
                <h2 class="text-2xl font-semibold text-gray-800 mb-6">Reset Password</h2>

                <p class="text-gray-600 mb-6">
                    Enter your email address and we'll send you instructions to reset your password.
                </p>

                <!-- Error Message -->
                {#if error}
                    <div class="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                        <p class="text-sm text-red-600">{error}</p>
                    </div>
                {/if}

                <form on:submit|preventDefault={handleResetRequest} class="space-y-5">
                    <!-- Email Input -->
                    <div>
                        <label for="email" class="block text-sm font-medium text-gray-700 mb-2">
                            Email Address
                        </label>
                        <input
                            id="email"
                            type="email"
                            bind:value={email}
                            disabled={loading}
                            placeholder="hr@company.com"
                            class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent transition"
                            required
                        />
                    </div>

                    <!-- Submit Button -->
                    <button
                        type="submit"
                        disabled={loading}
                        class="w-full py-3 bg-purple-600 text-white font-semibold rounded-lg hover:bg-purple-700 transition duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                    >
                        {#if loading}
                            <svg class="animate-spin h-5 w-5 mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            Sending...
                        {:else}
                            Send Reset Instructions
                        {/if}
                    </button>

                    <!-- Back Link -->
                    <div class="text-center">
                        <button
                            type="button"
                            on:click={goBack}
                            class="text-sm text-purple-600 hover:text-purple-800 font-medium"
                            disabled={loading}
                        >
                            Back to Login
                        </button>
                    </div>
                </form>
            {/if}
        </div>
    </div>
</div>