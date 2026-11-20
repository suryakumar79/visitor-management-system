<!-- src/routes/hr/profile/+page.svelte -->
<script>
    import { onMount } from 'svelte';
    import { account, databases, VMS_DATABASE_ID, STAFF_COLLECTION_ID, Query } from '$lib/client';
    import { goto } from '$app/navigation';

    let user = null;
    let staffData = null;
    let sessions = [];
    let isLoading = true;
    let errorMessage = '';
    let successMessage = '';

    onMount(async () => {
        await loadUserData();
        await loadStaffData();
        await loadSessions();
    });

    async function loadUserData() {
        try {
            user = await account.get();
        } catch (error) {
            console.error('Failed to load user data:', error);
            errorMessage = 'Failed to load user data';
            goto('/hr/login');
        }
    }

    async function loadStaffData() {
        try {
            if (!user) return;
            
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
                staffData = staffResponse.documents[0];
            }
        } catch (error) {
            console.error('Failed to load staff data:', error);
            errorMessage = 'Failed to load staff information';
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
                goto('/hr/login');
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
</script>

<svelte:head>
    <title>HR Profile - VMS</title>
</svelte:head>

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
            <h1 class="text-3xl font-bold text-gray-900">HR Profile</h1>
            <p class="text-gray-600 mt-1">View your profile information and manage active sessions</p>
        </div>

        {#if isLoading}
            <div class="bg-white rounded-lg shadow-sm p-6">
                <p class="text-center text-gray-600">Loading profile...</p>
            </div>
        {:else if user && staffData}
            <!-- Profile Information -->
            <div class="bg-white rounded-lg shadow-sm p-6">
                <h2 class="text-xl font-semibold text-gray-900 mb-4">Profile Information</h2>
                
                <div class="space-y-4">
                    <!-- Name -->
                    <div class="flex items-center p-4 bg-gray-50 rounded-lg">
                        <div class="flex items-center space-x-3 flex-1">
                            <span class="text-xl">👤</span>
                            <div class="flex-1">
                                <p class="text-sm text-gray-600">Full Name</p>
                                <p class="font-medium text-gray-900">{staffData.name || 'Not set'}</p>
                            </div>
                        </div>
                    </div>

                    <!-- Employee Code -->
                    <div class="flex items-center p-4 bg-gray-50 rounded-lg">
                        <div class="flex items-center space-x-3 flex-1">
                            <span class="text-xl">🆔</span>
                            <div class="flex-1">
                                <p class="text-sm text-gray-600">Employee Code</p>
                                <p class="font-medium text-gray-900 font-mono">{staffData.employeeCode || 'Not set'}</p>
                            </div>
                        </div>
                    </div>

                    <!-- Email -->
                    <div class="flex items-center p-4 bg-gray-50 rounded-lg">
                        <div class="flex items-center space-x-3 flex-1">
                            <span class="text-xl">📧</span>
                            <div class="flex-1">
                                <p class="text-sm text-gray-600">Email</p>
                                <p class="font-medium text-gray-900">{staffData.email || user.email}</p>
                                {#if user.emailVerification}
                                    <span class="inline-block mt-1 px-2 py-1 bg-green-100 text-green-700 text-xs font-medium rounded">Verified</span>
                                {:else}
                                    <span class="inline-block mt-1 px-2 py-1 bg-yellow-100 text-yellow-700 text-xs font-medium rounded">Not Verified</span>
                                {/if}
                            </div>
                        </div>
                    </div>

                    <!-- Phone -->
                    <div class="flex items-center p-4 bg-gray-50 rounded-lg">
                        <div class="flex items-center space-x-3 flex-1">
                            <span class="text-xl">📱</span>
                            <div class="flex-1">
                                <p class="text-sm text-gray-600">Phone Number</p>
                                <p class="font-medium text-gray-900">{staffData.phone || 'Not set'}</p>
                            </div>
                        </div>
                    </div>

                    <!-- Department -->
                    <div class="flex items-center p-4 bg-gray-50 rounded-lg">
                        <div class="flex items-center space-x-3 flex-1">
                            <span class="text-xl">🏢</span>
                            <div class="flex-1">
                                <p class="text-sm text-gray-600">Department</p>
                                <p class="font-medium text-gray-900">{staffData.departmentName || 'HR Department'}</p>
                            </div>
                        </div>
                    </div>

                    <!-- Position/Role -->
                    <div class="flex items-center p-4 bg-gray-50 rounded-lg">
                        <div class="flex items-center space-x-3 flex-1">
                            <span class="text-xl">💼</span>
                            <div class="flex-1">
                                <p class="text-sm text-gray-600">Role</p>
                                <p class="font-medium text-gray-900">
                                    {staffData.role}
                                    {#if staffData.positionName}
                                        <span class="text-sm text-gray-600"> - {staffData.positionName}</span>
                                    {/if}
                                </p>
                            </div>
                        </div>
                    </div>

                    <!-- Account Created -->
                    <div class="flex items-center p-4 bg-gray-50 rounded-lg">
                        <div class="flex items-center space-x-3 flex-1">
                            <span class="text-xl">📅</span>
                            <div class="flex-1">
                                <p class="text-sm text-gray-600">Account Created</p>
                                <p class="font-medium text-gray-900">
                                    {new Date(user.$createdAt).toLocaleDateString('en-US', { 
                                        year: 'numeric', 
                                        month: 'long', 
                                        day: 'numeric' 
                                    })}
                                </p>
                            </div>
                        </div>
                    </div>

                    <!-- Status -->
                    <div class="flex items-center p-4 bg-gray-50 rounded-lg">
                        <div class="flex items-center space-x-3 flex-1">
                            <span class="text-xl">✅</span>
                            <div class="flex-1">
                                <p class="text-sm text-gray-600">Account Status</p>
                                <p class="font-medium text-gray-900">
                                    {#if staffData.status === 'active'}
                                        <span class="inline-block px-3 py-1 bg-green-100 text-green-700 text-sm font-medium rounded-full">Active</span>
                                    {:else}
                                        <span class="inline-block px-3 py-1 bg-gray-100 text-gray-700 text-sm font-medium rounded-full">{staffData.status}</span>
                                    {/if}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Info Note -->
                <div class="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                    <div class="flex items-start gap-3">
                        <span class="text-xl">ℹ️</span>
                        <div>
                            <p class="text-sm font-medium text-blue-900">Profile Information is View-Only</p>
                            <p class="text-xs text-blue-700 mt-1">
                                To update your profile information (name, email, phone, employee code), please contact your system administrator.
                            </p>
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
        {:else if user && !staffData}
            <!-- No Staff Data Found -->
            <div class="bg-white rounded-lg shadow-sm p-6">
                <div class="text-center py-8">
                    <span class="text-6xl mb-4 block">⚠️</span>
                    <h3 class="text-xl font-semibold text-gray-900 mb-2">Staff Information Not Found</h3>
                    <p class="text-gray-600 mb-4">
                        Your account exists, but we couldn't find your staff profile in the system.
                    </p>
                    <p class="text-sm text-gray-500">
                        Please contact your system administrator to resolve this issue.
                    </p>
                </div>
            </div>
        {/if}
    </div>
</div>