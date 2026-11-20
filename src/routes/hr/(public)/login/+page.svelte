<script>
    import { goto } from '$app/navigation';
    import { account, databases, VMS_DATABASE_ID, STAFF_COLLECTION_ID, Query } from '$lib/client';
    import { onMount } from 'svelte';


    let email = '';
    let password = '';
    let error = '';
    let loading = false;

    // Check if already logged in
    onMount(async () => {
        try {
            const user = await account.get();
            
            // Check if has HR role in Staff collection
            const staffResponse = await databases.listDocuments(
                VMS_DATABASE_ID,
                STAFF_COLLECTION_ID,
                [
                    Query.equal('email', user.email),
                    Query.equal('role', 'HR'),
                    Query.limit(1)
                ]
            );
            
            if (staffResponse.documents.length > 0) {
                goto('/hr');
            }
        } catch (e) {
            // Not logged in, stay on login page
        }
    });

    async function handleLogin() {
        if (!email || !password) {
            error = 'Please enter both email and password';
            return;
        }

        loading = true;
        error = '';

        try {
            // Create email session
            await account.createEmailPasswordSession(email, password);
            
            // Get user details
            const user = await account.get();
            
            // Check Staff Collection for HR role
            const staffResponse = await databases.listDocuments(
                VMS_DATABASE_ID,
                STAFF_COLLECTION_ID,
                [
                    Query.equal('email', user.email),
                    Query.limit(1)
                ]
            );
            
            if (staffResponse.documents.length === 0) {
                // No staff document found
                await account.deleteSession('current');
                error = 'No staff record found for this email. Please contact your administrator.';
                loading = false;
                return;
            }
            
            // Check if the staff member has HR role
            const staffDoc = staffResponse.documents[0];
            
            if (staffDoc.role !== 'HR') {
                // Staff document exists but role is not HR
                await account.deleteSession('current');
                error = 'Access denied. This portal is for HR staff only.';
                loading = false;
                return;
            }
            
            // Success! Redirect to HR dashboard
            goto('/hr');
            
        } catch (e) {
            console.error('Login error:', e);
            if (e.code === 401) {
                error = 'Invalid email or password';
            } else {
                error = 'Login failed. Please try again.';
            }
            loading = false;
        }
    }

    function handleForgotPassword() {
        goto('/hr/forgot-password');
    }
</script>

<svelte:head>
    <title>HR Login - VMS</title>
</svelte:head>

<div class="min-h-screen bg-gradient-to-br from-purple-50 to-indigo-100 flex items-center justify-center p-4">
    <div class="max-w-md w-full">
        <!-- Logo/Header -->
        <div class="text-center mb-8">
            <div class="inline-block p-4 bg-purple-600 rounded-full mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
            </div>
            <h1 class="text-3xl font-bold text-gray-800">HR Portal</h1>
            <p class="text-gray-600 mt-2">Human Resources Management</p>
        </div>

        <!-- Login Card -->
        <div class="bg-white rounded-xl shadow-2xl p-8">
            <h2 class="text-2xl font-semibold text-gray-800 mb-6">Sign In</h2>

            <!-- Error Message -->
            {#if error}
                <div class="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                    <p class="text-sm text-red-600">{error}</p>
                </div>
            {/if}

            <form on:submit|preventDefault={handleLogin} class="space-y-5">
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

                <!-- Password Input -->
                <div>
                    <label for="password" class="block text-sm font-medium text-gray-700 mb-2">
                        Password
                    </label>
                    <input
                        id="password"
                        type="password"
                        bind:value={password}
                        disabled={loading}
                        placeholder="••••••••"
                        class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent transition"
                        required
                    />
                </div>

                <!-- Forgot Password Link -->
                <!--<div class="text-right">
                    <button
                        type="button"
                        on:click={handleForgotPassword}
                        class="text-sm text-purple-600 hover:text-purple-800 font-medium"
                        disabled={loading}
                    >
                        Forgot Password?
                    </button>
                </div>-->

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
                        Signing In...
                    {:else}
                        Sign In
                    {/if}
                </button>
            </form>

            <!-- Additional Links -->
            <div class="mt-6 pt-6 border-t border-gray-200 text-center">
                <p class="text-sm text-gray-600">
                    Need access? Contact your administrator
                </p>
            </div>
        </div>

        <!-- Footer -->
        <div class="mt-6 text-center">
            <p class="text-sm text-gray-500">
                Visitor Management System
            </p>
        </div>
    </div>
</div>