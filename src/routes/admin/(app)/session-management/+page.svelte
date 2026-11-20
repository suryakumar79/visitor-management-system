<!-- src/routes/admin/sessions/+page.svelte -->
<script>
    import { onMount } from 'svelte';
    import { account } from '$lib/client';
    import { Query } from '$lib/query.js';

    let users = [];
    let isLoading = true;
    let errorMessage = '';
    let successMessage = '';

    onMount(async () => {
        await loadUsers();
    });

    async function loadUsers() {
        isLoading = true;
        errorMessage = '';
        
        try {
            // Call our API endpoint to get users
            const response = await fetch('/api/admin/users', {
                credentials: 'include'
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to fetch users');
            }
            
            const data = await response.json();
            
            if (!data.success) {
                throw new Error(data.error || 'Failed to fetch users');
            }
            
            users = data.users || [];
            
            // For each user, get their active sessions
            for (let user of users) {
                user.sessions = await getUserSessions(user.$id);
            }
            
            isLoading = false;
        } catch (error) {
            console.error('Failed to load users:', error);
            errorMessage = error.message || 'Failed to load users and sessions';
            isLoading = false;
        }
    }

    async function getUserSessions(userId) {
        try {
            // Call API to get user sessions
            const response = await fetch(`/api/admin/users/${userId}/sessions`, {
                credentials: 'include'
            });
            
            if (!response.ok) {
                return [];
            }
            
            const data = await response.json();
            return data.sessions || [];
        } catch (error) {
            console.error(`Failed to load sessions for user ${userId}:`, error);
            return [];
        }
    }

    async function terminateSession(userId, sessionId, userName) {
    console.log('🔍 Attempting to terminate:', { userId, sessionId, userName });
    
    if (!confirm(`Terminate this session for ${userName}?`)) {
        return;
    }

    try {
        const response = await fetch('/api/admin/sessions/terminate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({
                userId: userId,
                sessionId: sessionId
            })
        });

        const data = await response.json();
        console.log('📨 Terminate response:', data);

        if (response.ok && data.success) {
            successMessage = 'Session terminated successfully';
            setTimeout(() => successMessage = '', 3000);
            await loadUsers(); // Reload to update the list
        } else {
            throw new Error(data.error || 'Failed to terminate session');
        }
    } catch (error) {
        console.error('❌ Failed to terminate session:', error);
        errorMessage = error.message || 'Failed to terminate session';
        setTimeout(() => errorMessage = '', 3000);
    }
}

    function formatDate(dateString) {
        if (!dateString) return 'N/A';
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now - date;
        const diffDays = Math.floor(diffMs / 86400000);
        
        if (diffDays === 0) return 'Today';
        if (diffDays === 1) return 'Yesterday';
        if (diffDays < 7) return `${diffDays} days ago`;
        
        return date.toLocaleDateString('en-IN', { 
            year: 'numeric',
            month: 'short', 
            day: 'numeric'
        });
    }

    function getDeviceIcon(clientName) {
        const client = (clientName || '').toLowerCase();
        if (client.includes('chrome')) return '🌐';
        if (client.includes('firefox')) return '🦊';
        if (client.includes('safari')) return '🧭';
        if (client.includes('mobile') || client.includes('android') || client.includes('ios')) return '📱';
        return '💻';
    }
</script>

<div class="min-h-screen bg-gray-50 py-8 px-4">
    <div class="max-w-7xl mx-auto">
        
        <!-- Header -->
        <div class="bg-white rounded-lg shadow-sm p-6 mb-6">
            <div class="flex items-center justify-between">
                <div>
                    <h1 class="text-3xl font-bold text-gray-900">User Sessions</h1>
                    <p class="text-gray-600 mt-1">View and manage all active user sessions</p>
                </div>
                <button 
                    on:click={loadUsers}
                    class="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium"
                >
                    🔄 Refresh
                </button>
            </div>
        </div>

        <!-- Messages -->
        {#if errorMessage}
            <div class="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg mb-6">
                {errorMessage}
            </div>
        {/if}

        {#if successMessage}
            <div class="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded-lg mb-6">
                {successMessage}
            </div>
        {/if}

        <!-- Loading State -->
        {#if isLoading}
            <div class="bg-white rounded-lg shadow-sm p-12 text-center">
                <div class="text-4xl mb-4">⏳</div>
                <p class="text-gray-600">Loading users and sessions...</p>
            </div>
        {:else}
            <!-- Users List -->
            <div class="space-y-4">
                {#each users as user}
                    <div class="bg-white rounded-lg shadow-sm overflow-hidden">
                        <!-- User Header -->
                        <div class="p-6 border-b border-gray-200 bg-gray-50">
                            <div class="flex items-center justify-between">
                                <div class="flex items-center space-x-4">
                                    <!-- Avatar -->
                                    <div class="w-12 h-12 bg-indigo-600 rounded-full flex items-center justify-center">
                                        <span class="text-xl font-bold text-white">
                                            {user.name?.charAt(0)?.toUpperCase() || user.email?.charAt(0)?.toUpperCase() || '?'}
                                        </span>
                                    </div>
                                    
                                    <!-- User Info -->
                                    <div>
                                        <div class="flex items-center space-x-2">
                                            <h3 class="text-lg font-semibold text-gray-900">
                                                {user.name || 'No Name'}
                                            </h3>
                                            {#if user.status}
                                                <span class={`px-3 py-1 text-xs font-semibold rounded-full ${
                                                    user.emailVerification 
                                                        ? 'bg-green-100 text-green-700' 
                                                        : 'bg-yellow-100 text-yellow-700'
                                                }`}>
                                                    {user.emailVerification ? 'VERIFIED' : 'UNVERIFIED'}
                                                </span>
                                            {/if}
                                        </div>
                                        <div class="text-sm text-gray-600 space-y-1">
                                            <p>
                                                📧 {user.email || 'No email'}
                                            </p>
                                            {#if user.phone}
                                                <p>📱 {user.phone}</p>
                                            {/if}
                                            <p class="text-xs text-gray-500">
                                                User ID: {user.$id}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                                
                                <!-- Session Count & Activity -->
                                <div class="text-right">
                                    <div class="text-2xl font-bold text-indigo-600">
                                        {user.sessions?.length || 0}
                                    </div>
                                    <div class="text-xs text-gray-500">
                                        Active {user.sessions?.length === 1 ? 'Session' : 'Sessions'}
                                    </div>
                                    {#if user.$createdAt}
                                        <div class="text-xs text-gray-500 mt-1">
                                            Joined: {formatDate(user.$createdAt)}
                                        </div>
                                    {/if}
                                </div>
                            </div>
                        </div>

                        <!-- Sessions List -->
                        <div class="p-6">
                            {#if user.sessions && user.sessions.length > 0}
                                <div class="space-y-3">
                                    {#each user.sessions as session}
                                        <div class="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200 hover:border-gray-300 transition-colors">
                                            <div class="flex items-center space-x-4 flex-1">
                                                <!-- Device Icon -->
                                                <div class="text-3xl">
                                                    {getDeviceIcon(session.clientName)}
                                                </div>
                                                
                                                <!-- Session Details -->
                                                <div class="flex-1">
                                                    <div class="flex items-center space-x-2">
                                                        <p class="font-medium text-gray-900">
                                                            {session.clientName || 'Unknown Browser'}
                                                        </p>
                                                        {#if session.isCurrent || session.current}
                                                            <span class="px-2 py-1 bg-green-100 text-green-700 text-xs font-medium rounded">
                                                                Current
                                                            </span>
                                                        {/if}
                                                    </div>
                                                    
                                                    <div class="text-sm text-gray-600 mt-1 space-y-1">
                                                        <p>
                                                            <span class="font-medium">Device:</span> {session.deviceName || session.osName || 'Unknown'}
                                                            {#if session.osVersion} ({session.osVersion}){/if}
                                                        </p>
                                                        <p>
                                                            <span class="font-medium">Location:</span> 
                                                            {session.ip || 'N/A'} 
                                                            {#if session.countryName}
                                                                • {session.countryName}
                                                            {/if}
                                                        </p>
                                                        <p>
                                                            <span class="font-medium">Login:</span> 
                                                            {session.loginTime 
                                                                ? new Date(session.loginTime).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
                                                                : (session.$createdAt 
                                                                    ? new Date(session.$createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
                                                                    : 'N/A')
                                                            }
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>
                                            
                                            <!-- Terminate Button -->
                                            <button
                                                on:click={() => terminateSession(user.$id, session.sessionId || session.$id, user.name || user.email)}
                                                class="ml-4 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
                                            >
                                                Terminate
                                            </button>
                                        </div>
                                    {/each}
                                </div>
                            {:else}
                                <div class="text-center py-8 text-gray-500">
                                    <div class="text-4xl mb-2">🔓</div>
                                    <p>No active sessions</p>
                                </div>
                            {/if}
                        </div>
                    </div>
                {/each}

                {#if users.length === 0}
                    <div class="bg-white rounded-lg shadow-sm p-12 text-center">
                        <div class="text-4xl mb-4">👥</div>
                        <p class="text-gray-600">No users found</p>
                    </div>
                {/if}
            </div>
        {/if}
    </div>
</div>