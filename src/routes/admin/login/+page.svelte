<!-- src/routes/admin/login/+page.svelte -->
<script>
    import { goto } from '$app/navigation';
    import { account } from '$lib/client';
    import { onMount } from 'svelte';

    let email = '';
    let password = '';
    let isLoading = false;
    let errorMessage = '';
    let checkingSession = true;

    // ✅ Check if already logged in AND is admin
    onMount(async () => {
        try {
            const user = await account.get();
            
            // ✅ Check if user has admin role/label
            // Option 1: Check labels (set on the account)
            if (user.labels && user.labels.includes('admin')) {
                console.log('✅ Existing admin session found, redirecting...');
                goto('/admin');
                return;
            }
            
            // Option 2: Check email domain or specific emails
            // const adminEmails = ['admin@company.com', 'superadmin@company.com'];
            // if (adminEmails.includes(user.email)) {
            //     goto('/admin');
            //     return;
            // }
            
            // ✅ User is logged in but NOT an admin - log them out
            console.log('Non-admin session detected, logging out...');
            await account.deleteSession('current');
            checkingSession = false;
            
        } catch (e) {
            // ✅ No active session - show login form
            console.log('No existing session, showing login form');
            checkingSession = false;
        }
    });

    async function handleLogin() {
        if (!email || !password) {
            errorMessage = 'Email and password are required.';
            return;
        }

        isLoading = true;
        errorMessage = '';

        try {
            // ✅ Delete any existing session first
            try {
                await account.deleteSession('current');
                console.log('✅ Cleared existing session');
            } catch (error) {
                console.log('No existing session to clear');
            }

            // ✅ Create new email/password session
            const session = await account.createEmailPasswordSession(email, password);
            console.log('✅ New session created');
            
            // ✅ Verify this user is an admin
            const user = await account.get();
            
            if (!user.labels || !user.labels.includes('admin')) {
                // Not an admin - delete session and show error
                await account.deleteSession('current');
                errorMessage = 'Access denied. Admin privileges required.';
                isLoading = false;
                return;
            }
            
            console.log('✅ Admin verified, redirecting...');
            goto('/admin');

        } catch (error) {
            console.error('Login failed:', error);
            
            if (error.code === 401) {
                errorMessage = 'Invalid email or password';
            } else {
                errorMessage = error.message || 'Login failed. Please try again.';
            }
            isLoading = false;
        }
    }
</script>

<svelte:head>
    <title>Admin Login - VMS</title>
</svelte:head>

{#if checkingSession}
    <!-- ✅ Show loading state while checking for existing session -->
    <div class="min-h-screen flex items-center justify-center bg-gray-100">
        <div class="text-center">
            <svg class="animate-spin h-12 w-12 text-indigo-600 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <p class="text-gray-600">Checking session...</p>
        </div>
    </div>
{:else}
    <!-- ✅ Show login form only if no existing session -->
    <div class="min-h-screen flex items-center justify-center bg-gray-100 p-4">
        <div class="w-full max-w-md bg-white rounded-lg shadow-md p-6 md:p-8">
            <h2 class="text-2xl font-bold text-center text-gray-800 mb-6">Admin Login</h2>

            <!-- Show error messages -->
            {#if errorMessage}
                <div class="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-md mb-4" role="alert">
                    <span class="block sm:inline">{errorMessage}</span>
                </div>
            {/if}

            <form on:submit|preventDefault={handleLogin}>
                <div class="mb-4">
                    <label for="email" class="block text-sm font-medium text-gray-700 mb-2">Email</label>
                    <input
                        type="email"
                        id="email"
                        bind:value={email}
                        class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                        placeholder="you@company.com"
                        disabled={isLoading}
                    />
                </div>

                <div class="mb-6">
                    <label for="password" class="block text-sm font-medium text-gray-700 mb-2">Password</label>
                    <input
                        type="password"
                        id="password"
                        bind:value={password}
                        class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                        placeholder="••••••••"
                        disabled={isLoading}
                    />
                </div>

                <div class="flex items-center justify-between mb-6">
                    <div /> <!-- Empty div for alignment -->
                    <a href="/admin/forgot-password" class="text-sm text-indigo-600 hover:underline">
                        Forgot Password?
                    </a>
                </div>

                <div>
                    <button
                        type="submit"
                        class="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 {isLoading ? 'opacity-50 cursor-not-allowed' : ''}"
                        disabled={isLoading}
                    >
                        {#if isLoading}
                            <svg class="animate-spin h-5 w-5 mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            Logging in...
                        {:else}
                            Login
                        {/if}
                    </button>
                </div>
            </form>
        </div>
    </div>
{/if}