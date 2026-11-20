<script>
    import { onMount } from 'svelte';
    import { Mail, Lock, LogIn, AlertCircle, Eye, EyeOff } from 'lucide-svelte';
    import { account } from '$lib/client';
    
    // State
    let email = '';
    let password = '';
    let showPassword = false;
    let isLoading = false;
    let error = '';
    let checkingSession = true;

    // Already signed in as a receptionist? Go straight to the dashboard.
    onMount(async () => {
        try {
            await account.get();
            const res = await fetch('/api/receptionists/me');
            if (res.ok) {
                const data = await res.json();
                sessionStorage.setItem('receptionistSession', JSON.stringify({ ...data.session, loginTime: new Date().toISOString() }));
                window.location.href = '/reception';
                return;
            }
        } catch {
            /* not signed in */
        }
        checkingSession = false;
    });

    function clearError() {
        if (error) error = '';
    }

    async function handleLogin() {
        if (!email || !password) {
            error = 'Please enter both email and password';
            return;
        }

        isLoading = true;
        error = '';

        try {
            await account.createEmailPasswordSession(email, password);

            // the server decides whether this account is a receptionist
            const res = await fetch('/api/receptionists/me');
            if (!res.ok) {
                await account.deleteSession('current');
                error = 'This account does not have reception access.';
                return;
            }
            const data = await res.json();
            sessionStorage.setItem('receptionistSession', JSON.stringify({ ...data.session, loginTime: new Date().toISOString() }));
            window.location.href = '/reception';
        } catch (err) {
            error = err.code === 429 ? err.message : 'Invalid email or password';
        } finally {
            isLoading = false;
        }
    }

    function handleKeyPress(e) {
        if (e.key === 'Enter') {
            handleLogin();
        }
    }
</script>

<svelte:head>
    <title>Receptionist Login</title>
</svelte:head>

{#if checkingSession}
    <!-- Loading state while checking for active session -->
    <div class="min-h-screen bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center p-4">
        <div class="text-center">
            <div class="w-16 h-16 border-4 border-white border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p class="text-white text-lg font-medium">Checking session...</p>
        </div>
    </div>
{:else}
    <div class="min-h-screen bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center p-4">
        <div class="w-full max-w-md">
            
            <!-- Login Card -->
            <div class="bg-white rounded-3xl shadow-2xl overflow-hidden">
                
                <!-- Header -->
                <div class="bg-gradient-to-r from-indigo-600 to-purple-600 p-8 text-white text-center">
                    <div class="w-20 h-20 bg-white rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg">
                        <LogIn class="w-10 h-10 text-indigo-600" />
                    </div>
                    <h1 class="text-3xl font-bold mb-2">Receptionist Login</h1>
                    <p class="text-indigo-100">Visitor Management System</p>
                </div>

                <!-- Form -->
                <div class="p-8">
                    
                    <!-- Error Message -->
                    {#if error}
                        <div class="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3">
                            <AlertCircle class="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                            <p class="text-sm text-red-700">{error}</p>
                        </div>
                    {/if}

                    <div class="space-y-6">
                        
                        <!-- Email Field -->
                        <div>
                            <label for="email" class="block text-sm font-medium text-gray-700 mb-2">
                                Email Address
                            </label>
                            <div class="relative">
                                <div class="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                                    <Mail class="w-5 h-5 text-gray-400" />
                                </div>
                                <input
                                    type="email"
                                    id="email"
                                    bind:value={email}
                                    on:input={clearError}
                                    on:keypress={handleKeyPress}
                                    class="w-full pl-12 pr-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
                                    placeholder="your.email@company.com"
                                    autocomplete="email"
                                    disabled={isLoading}
                                />
                            </div>
                        </div>

                        <!-- Password Field -->
                        <div>
                            <label for="password" class="block text-sm font-medium text-gray-700 mb-2">
                                Password
                            </label>
                            <div class="relative">
                                <div class="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                                    <Lock class="w-5 h-5 text-gray-400" />
                                </div>
                                <input
                                    type={showPassword ? 'text' : 'password'}
                                    id="password"
                                    bind:value={password}
                                    on:input={clearError}
                                    on:keypress={handleKeyPress}
                                    class="w-full pl-12 pr-12 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
                                    placeholder="Enter your password"
                                    autocomplete="current-password"
                                    disabled={isLoading}
                                />
                                <button
                                    type="button"
                                    on:click={() => showPassword = !showPassword}
                                    class="absolute inset-y-0 right-0 pr-4 flex items-center text-gray-400 hover:text-gray-600 transition"
                                    disabled={isLoading}
                                >
                                    {#if showPassword}
                                        <EyeOff class="w-5 h-5" />
                                    {:else}
                                        <Eye class="w-5 h-5" />
                                    {/if}
                                </button>
                            </div>
                        </div>

                        <!-- Submit Button -->
                        <button
                            on:click={handleLogin}
                            disabled={isLoading}
                            class="w-full py-3 px-4 bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-semibold rounded-xl hover:from-indigo-700 hover:to-purple-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg"
                        >
                            {#if isLoading}
                                <div class="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                Logging in...
                            {:else}
                                <LogIn class="w-5 h-5" />
                                Login
                            {/if}
                        </button>
                    </div>

                    <!-- Footer -->
                    <div class="mt-6 text-center">
                        <p class="text-sm text-gray-600">
                            Contact your administrator for login assistance
                        </p>
                    </div>
                </div>
            </div>

            <!-- Security Notice -->
            <div class="mt-6 text-center">
                <p class="text-sm text-white text-opacity-90">
                    🔒 Your connection is secure and encrypted
                </p>
            </div>
        </div>
    </div>
{/if}