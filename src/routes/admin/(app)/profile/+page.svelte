<!-- src/routes/admin/profile/+page.svelte -->
<script>
    import { onMount } from 'svelte';
    import { account } from '$lib/client';
    import { goto } from '$app/navigation';

    let user = null;
    let sessions = [];
    let isLoading = true;
    let errorMessage = '';
    let successMessage = '';

    // Edit mode states
    let editMode = {
        username: false,
        email: false,
        password: false,
        phone: false
    };

    // Temporary values for editing
    let tempValues = {
        username: '',
        email: '',
        phone: '',
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
        emailPassword: '',
        phonePassword: ''
    };

    onMount(async () => {
        await loadUserData();
        await loadSessions();
    });

    async function loadUserData() {
        try {
            user = await account.get();
            tempValues.username = user.name || '';
            tempValues.email = user.email || '';
            tempValues.phone = user.phone || '';
        } catch (error) {
            console.error('Failed to load user data:', error);
            errorMessage = 'Failed to load user data';
            goto('/login');
        }
    }

    async function loadSessions() {
        try {
            const sessionsList = await account.listSessions();
            sessions = sessionsList.sessions;
            isLoading = false;
        } catch (error) {
            console.error('Failed to load sessions:', error);
            errorMessage = 'Failed to load sessions';
            isLoading = false;
        }
    }

    function getDeviceIcon(clientName) {
        const client = clientName.toLowerCase();
        if (client.includes('chrome')) return '🌐';
        if (client.includes('firefox')) return '🦊';
        if (client.includes('safari')) return '🧭';
        if (client.includes('edge')) return '🔷';
        if (client.includes('mobile') || client.includes('android') || client.includes('ios')) return '📱';
        return '💻';
    }

    function formatDate(dateString) {
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
        if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
        return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    }

    async function handleLogoutSession(sessionId) {
        try {
            const session = sessions.find(s => s.$id === sessionId);
            
            if (session?.current) {
                const confirmed = confirm('This will log you out from this device. Continue?');
                if (!confirmed) return;
            }

            await account.deleteSession(sessionId);
            
            if (session?.current) {
                goto('/login');
            } else {
                successMessage = 'Session terminated successfully';
                await loadSessions();
                setTimeout(() => successMessage = '', 3000);
            }
        } catch (error) {
            console.error('Failed to logout session:', error);
            errorMessage = 'Failed to logout session';
            setTimeout(() => errorMessage = '', 3000);
        }
    }

    function handleEdit(field) {
        editMode[field] = true;
    }

    function handleCancel(field) {
        editMode[field] = false;
        if (user) {
            tempValues.username = user.name || '';
            tempValues.email = user.email || '';
            tempValues.phone = user.phone || '';
        }
        tempValues.currentPassword = '';
        tempValues.newPassword = '';
        tempValues.confirmPassword = '';
        tempValues.emailPassword = '';
        tempValues.phonePassword = '';
    }

    async function handleSave(field) {
        errorMessage = '';
        successMessage = '';

        try {
            if (field === 'username') {
                if (!tempValues.username.trim()) {
                    errorMessage = 'Username cannot be empty';
                    setTimeout(() => errorMessage = '', 3000);
                    return;
                }
                
                await account.updateName(tempValues.username);
                successMessage = 'Username updated successfully!';
                editMode.username = false;
                await loadUserData();
                
            } else if (field === 'email') {
                // Validate email
                if (!tempValues.email.trim()) {
                    errorMessage = 'Email cannot be empty';
                    setTimeout(() => errorMessage = '', 3000);
                    return;
                }
                
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!emailRegex.test(tempValues.email)) {
                    errorMessage = 'Please enter a valid email address';
                    setTimeout(() => errorMessage = '', 3000);
                    return;
                }
                
                if (!tempValues.emailPassword) {
                    errorMessage = 'Please enter your current password';
                    setTimeout(() => errorMessage = '', 3000);
                    return;
                }
                
                // Update email
                await account.updateEmail(tempValues.email, tempValues.emailPassword);
                successMessage = 'Email updated successfully!';
                editMode.email = false;
                tempValues.emailPassword = '';
                await loadUserData();
                
            } else if (field === 'password') {
                // Validate password fields
                if (!tempValues.currentPassword) {
                    errorMessage = 'Please enter your current password';
                    setTimeout(() => errorMessage = '', 3000);
                    return;
                }
                
                if (!tempValues.newPassword) {
                    errorMessage = 'Please enter a new password';
                    setTimeout(() => errorMessage = '', 3000);
                    return;
                }
                
                if (tempValues.newPassword.length < 8) {
                    errorMessage = 'Password must be at least 8 characters long';
                    setTimeout(() => errorMessage = '', 3000);
                    return;
                }
                
                if (tempValues.newPassword !== tempValues.confirmPassword) {
                    errorMessage = 'Passwords do not match';
                    setTimeout(() => errorMessage = '', 3000);
                    return;
                }
                
                // Update password
                await account.updatePassword(tempValues.newPassword, tempValues.currentPassword);
                successMessage = 'Password updated successfully!';
                editMode.password = false;
                tempValues.currentPassword = '';
                tempValues.newPassword = '';
                tempValues.confirmPassword = '';
                
            } else if (field === 'phone') {
                // Validate phone
                if (!tempValues.phone.trim()) {
                    errorMessage = 'Phone number cannot be empty';
                    setTimeout(() => errorMessage = '', 3000);
                    return;
                }
                
                // Phone should start with + and country code
                if (!tempValues.phone.startsWith('+')) {
                    errorMessage = 'Phone number must start with + and country code (e.g., +1234567890)';
                    setTimeout(() => errorMessage = '', 3000);
                    return;
                }
                
                if (!tempValues.phonePassword) {
                    errorMessage = 'Please enter your current password';
                    setTimeout(() => errorMessage = '', 3000);
                    return;
                }
                
                // Update phone
                await account.updatePhone(tempValues.phone, tempValues.phonePassword);
                successMessage = 'Phone number updated successfully!';
                editMode.phone = false;
                tempValues.phonePassword = '';
                await loadUserData();
            }
            
            setTimeout(() => successMessage = '', 3000);
        } catch (error) {
            console.error('Failed to update:', error);
            errorMessage = error.message || 'Failed to update';
            setTimeout(() => errorMessage = '', 3000);
        }
    }
</script>

<div class="min-h-screen bg-gray-50 py-8 px-4">
    <div class="max-w-4xl mx-auto space-y-6">
        
        <!-- Messages -->
        {#if errorMessage}
            <div class="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg" role="alert">
                <span>{errorMessage}</span>
            </div>
        {/if}

        {#if successMessage}
            <div class="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded-lg" role="alert">
                <span>{successMessage}</span>
            </div>
        {/if}

        <!-- Header -->
        <div class="bg-white rounded-lg shadow-sm p-6">
            <h1 class="text-3xl font-bold text-gray-900">Admin Profile</h1>
            <p class="text-gray-600 mt-1">Manage your account settings and security</p>
        </div>

        {#if isLoading}
            <div class="bg-white rounded-lg shadow-sm p-6">
                <p class="text-center text-gray-600">Loading profile...</p>
            </div>
        {:else if user}
            <!-- Profile Information -->
            <div class="bg-white rounded-lg shadow-sm p-6">
                <h2 class="text-xl font-semibold text-gray-900 mb-4">Profile Information</h2>
                
                <div class="space-y-4">
                    <!-- User ID (Read-only) -->
                    <div class="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                        <div class="flex items-center space-x-3 flex-1">
                            <span class="text-xl">🆔</span>
                            <div class="flex-1">
                                <p class="text-sm text-gray-600">User ID</p>
                                <p class="font-medium text-gray-900 font-mono text-sm">{user.$id}</p>
                            </div>
                        </div>
                    </div>

                    <!-- Username -->
                    <div class="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                        <div class="flex items-center space-x-3 flex-1">
                            <span class="text-xl">👤</span>
                            <div class="flex-1">
                                <p class="text-sm text-gray-600">Username</p>
                                {#if editMode.username}
                                    <input
                                        type="text"
                                        bind:value={tempValues.username}
                                        class="mt-1 px-3 py-2 border border-gray-300 rounded w-full max-w-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                    />
                                {:else}
                                    <p class="font-medium text-gray-900">{user.name || 'Not set'}</p>
                                {/if}
                            </div>
                        </div>
                        <div class="flex space-x-2">
                            {#if editMode.username}
                                <button on:click={() => handleSave('username')} class="px-3 py-2 text-green-600 hover:bg-green-50 rounded font-medium">
                                    Save
                                </button>
                                <button on:click={() => handleCancel('username')} class="px-3 py-2 text-red-600 hover:bg-red-50 rounded font-medium">
                                    Cancel
                                </button>
                            {:else}
                                <button on:click={() => handleEdit('username')} class="px-3 py-2 text-indigo-600 hover:bg-indigo-50 rounded font-medium">
                                    Edit
                                </button>
                            {/if}
                        </div>
                    </div>

                    <!-- Email -->
                    <div class="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                        <div class="flex items-center space-x-3 flex-1">
                            <span class="text-xl">📧</span>
                            <div class="flex-1">
                                <p class="text-sm text-gray-600">Email</p>
                                {#if editMode.email}
                                    <div class="mt-2 space-y-2 max-w-xs">
                                        <input
                                            type="email"
                                            bind:value={tempValues.email}
                                            placeholder="New email"
                                            class="px-3 py-2 border border-gray-300 rounded w-full focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                        />
                                        <input
                                            type="password"
                                            bind:value={tempValues.emailPassword}
                                            placeholder="Current password"
                                            class="px-3 py-2 border border-gray-300 rounded w-full focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                        />
                                    </div>
                                {:else}
                                    <p class="font-medium text-gray-900">{user.email}</p>
                                    {#if user.emailVerification}
                                        <span class="inline-block mt-1 px-2 py-1 bg-green-100 text-green-700 text-xs font-medium rounded">Verified</span>
                                    {:else}
                                        <span class="inline-block mt-1 px-2 py-1 bg-yellow-100 text-yellow-700 text-xs font-medium rounded">Not Verified</span>
                                    {/if}
                                {/if}
                            </div>
                        </div>
                        <div class="flex space-x-2">
                            {#if editMode.email}
                                <button on:click={() => handleSave('email')} class="px-3 py-2 text-green-600 hover:bg-green-50 rounded font-medium">
                                    Save
                                </button>
                                <button on:click={() => handleCancel('email')} class="px-3 py-2 text-red-600 hover:bg-red-50 rounded font-medium">
                                    Cancel
                                </button>
                            {:else}
                                <button on:click={() => handleEdit('email')} class="px-3 py-2 text-indigo-600 hover:bg-indigo-50 rounded font-medium">
                                    Edit
                                </button>
                            {/if}
                        </div>
                    </div>

                    <!-- Phone -->
                    <div class="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                        <div class="flex items-center space-x-3 flex-1">
                            <span class="text-xl">📱</span>
                            <div class="flex-1">
                                <p class="text-sm text-gray-600">Phone Number</p>
                                {#if editMode.phone}
                                    <div class="mt-2 space-y-2 max-w-xs">
                                        <input
                                            type="tel"
                                            bind:value={tempValues.phone}
                                            placeholder="New phone number (e.g., +1234567890)"
                                            class="px-3 py-2 border border-gray-300 rounded w-full focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                        />
                                        <input
                                            type="password"
                                            bind:value={tempValues.phonePassword}
                                            placeholder="Current password"
                                            class="px-3 py-2 border border-gray-300 rounded w-full focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                        />
                                        <p class="text-xs text-gray-500">Format: +[country code][number]</p>
                                    </div>
                                {:else}
                                    <p class="font-medium text-gray-900">{user.phone || 'Not set'}</p>
                                    {#if user.phoneVerification}
                                        <span class="inline-block mt-1 px-2 py-1 bg-green-100 text-green-700 text-xs font-medium rounded">Verified</span>
                                    {:else if user.phone}
                                        <span class="inline-block mt-1 px-2 py-1 bg-yellow-100 text-yellow-700 text-xs font-medium rounded">Not Verified</span>
                                    {/if}
                                {/if}
                            </div>
                        </div>
                        <div class="flex space-x-2">
                            {#if editMode.phone}
                                <button on:click={() => handleSave('phone')} class="px-3 py-2 text-green-600 hover:bg-green-50 rounded font-medium">
                                    Save
                                </button>
                                <button on:click={() => handleCancel('phone')} class="px-3 py-2 text-red-600 hover:bg-red-50 rounded font-medium">
                                    Cancel
                                </button>
                            {:else}
                                <button on:click={() => handleEdit('phone')} class="px-3 py-2 text-indigo-600 hover:bg-indigo-50 rounded font-medium">
                                    Edit
                                </button>
                            {/if}
                        </div>
                    </div>

                    <!-- Password -->
                    <div class="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                        <div class="flex items-center space-x-3 flex-1">
                            <span class="text-xl">🔒</span>
                            <div class="flex-1">
                                <p class="text-sm text-gray-600">Password</p>
                                {#if editMode.password}
                                    <div class="mt-2 space-y-2 max-w-xs">
                                        <input
                                            type="password"
                                            bind:value={tempValues.currentPassword}
                                            placeholder="Current password"
                                            class="px-3 py-2 border border-gray-300 rounded w-full focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                        />
                                        <input
                                            type="password"
                                            bind:value={tempValues.newPassword}
                                            placeholder="New password (min 8 characters)"
                                            class="px-3 py-2 border border-gray-300 rounded w-full focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                        />
                                        <input
                                            type="password"
                                            bind:value={tempValues.confirmPassword}
                                            placeholder="Confirm new password"
                                            class="px-3 py-2 border border-gray-300 rounded w-full focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                        />
                                    </div>
                                {:else}
                                    <p class="font-medium text-gray-900">••••••••</p>
                                {/if}
                            </div>
                        </div>
                        <div class="flex space-x-2">
                            {#if editMode.password}
                                <button on:click={() => handleSave('password')} class="px-3 py-2 text-green-600 hover:bg-green-50 rounded font-medium">
                                    Save
                                </button>
                                <button on:click={() => handleCancel('password')} class="px-3 py-2 text-red-600 hover:bg-red-50 rounded font-medium">
                                    Cancel
                                </button>
                            {:else}
                                <button on:click={() => handleEdit('password')} class="px-3 py-2 text-indigo-600 hover:bg-indigo-50 rounded font-medium">
                                    Edit
                                </button>
                            {/if}
                        </div>
                    </div>

                    <!-- Account Created -->
                    <div class="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                        <div class="flex items-center space-x-3 flex-1">
                            <span class="text-xl">📅</span>
                            <div class="flex-1">
                                <p class="text-sm text-gray-600">Account Created</p>
                                <p class="font-medium text-gray-900">{new Date(user.$createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Active Sessions -->
            <div class="bg-white rounded-lg shadow-sm p-6">
                <div class="flex items-center justify-between mb-4">
                    <div>
                        <h2 class="text-xl font-semibold text-gray-900">Active Sessions</h2>
                        <p class="text-sm text-gray-600 mt-1">
                            You have {sessions.length} active {sessions.length === 1 ? 'session' : 'sessions'}
                        </p>
                    </div>
                </div>
                
                <div class="space-y-3">
                    {#each sessions as session}
                        <div class="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:border-gray-300 transition-colors">
                            <div class="flex items-center space-x-4">
                                <div class="text-3xl">
                                    {getDeviceIcon(session.clientName)}
                                </div>
                                <div>
                                    <div class="flex items-center space-x-2">
                                        <p class="font-medium text-gray-900">{session.clientName} on {session.osName}</p>
                                        {#if session.current}
                                            <span class="px-2 py-1 bg-green-100 text-green-700 text-xs font-medium rounded">
                                                Current
                                            </span>
                                        {/if}
                                    </div>
                                    <p class="text-sm text-gray-600">{session.countryName} • {session.ip}</p>
                                    <p class="text-xs text-gray-500">Created: {formatDate(session.$createdAt)}</p>
                                </div>
                            </div>
                            <button
                                on:click={() => handleLogoutSession(session.$id)}
                                class="px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors font-medium"
                            >
                                Logout
                            </button>
                        </div>
                    {/each}
                </div>
            </div>
        {/if}
    </div>
</div>