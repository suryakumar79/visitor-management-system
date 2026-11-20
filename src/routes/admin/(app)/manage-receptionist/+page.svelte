<script>
    import { onMount } from 'svelte';
    import { 
        UserPlus, User, Mail, Briefcase, Key, RefreshCw, XCircle, Edit, Save, Trash2, X, Eye, EyeOff, Copy, CheckCircle
    } from 'lucide-svelte';

    // DATA CLIENT
    import { 
        databases,
        Query, 
        VMS_DATABASE_ID, 
        DEPARTMENTS_COLLECTION_ID, 
        RECEPTIONIST_ID
    } from '$lib/client';

    // State Management
    let departments = [];
    let receptionists = [];
    
    // OPTIMIZED: Lookup map for O(1) department access
    let departmentsMap = new Map();
    
    let isLoading = false;
    let isSubmitting = false;
    let message = { text: '', type: '' };

    let newReceptionist = {
        name: '',
        departmentId: '', 
        email: '',
    };
    
    let editingReceptionist = null;
    
    // Password visibility states

    // Passwords are never stored in readable form. A generated one is shown once, right after it is set.
    let issued = null; // { name, email, password }
    let copied = false;

    function randomInt(max) {
        const buf = new Uint32Array(1);
        const limit = Math.floor(0x100000000 / max) * max;
        do { crypto.getRandomValues(buf); } while (buf[0] >= limit);
        return buf[0] % max;
    }

    function generateSecurePassword(length = 14) {
        const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%^&*-_=+'];
        const all = sets.join('');
        const chars = sets.map((set) => set[randomInt(set.length)]);
        while (chars.length < length) chars.push(all[randomInt(all.length)]);
        for (let i = chars.length - 1; i > 0; i--) { const j = randomInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
        return chars.join('');
    }

    async function copyIssued() {
        try { await navigator.clipboard.writeText(issued.password); copied = true; setTimeout(() => (copied = false), 2000); } catch { /* clipboard blocked */ }
    }

    // Utility Functions

    function setMessage(text, type = 'error') {
        message = { text, type };
        setTimeout(() => message = { text: '', type: '' }, 7000);
    }

    // OPTIMIZED: Use Map lookup instead of .find()
    function getDepartmentName(id) {
        return departmentsMap.get(id) || 'Unknown Department';
    }

    function resetForm() {
        newReceptionist = {
            name: '',
            departmentId: '',
            email: '',
        };
    }

    // Data Fetching

    async function loadDepartments() {
        try {
            const res = await databases.listDocuments(
                VMS_DATABASE_ID,
                DEPARTMENTS_COLLECTION_ID,
                [Query.limit(100)]
            );
            departments = res.documents;
            
            // OPTIMIZED: Build lookup map
            departmentsMap = new Map(departments.map(d => [d.$id, d.name]));
            
        } catch (e) {
            console.error("Failed to load departments:", e);
            setMessage('Failed to load departments for selection. Please try again.', 'error');
        }
    }

    async function loadReceptionists() {
        isLoading = true;
        receptionists = [];
        
        // OPTIMIZED: Clear cache on reload
        
        try {
            const res = await databases.listDocuments(
                VMS_DATABASE_ID,
                RECEPTIONIST_ID,
                [Query.orderAsc('name'), Query.limit(500)]
            );
            
            receptionists = res.documents;
        } catch (e) {
            console.error("Failed to fetch receptionists:", e);
            setMessage('Failed to load receptionists. Please try again.', 'error');
        } finally {
            isLoading = false;
        }
    }

    // Create Action - Call SvelteKit API endpoint

    async function handleAddReceptionist() {
        if (!newReceptionist.name || !newReceptionist.departmentId || !newReceptionist.email) {
            setMessage('Please fill in all fields correctly.', 'error');
            return;
        }

        isSubmitting = true;
        try {
            const generatedPassword = generateSecurePassword();

            const response = await fetch('/api/receptionists/create', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    name: newReceptionist.name,
                    email: newReceptionist.email,
                    departmentId: newReceptionist.departmentId,
                    password: generatedPassword
                })
            });

            const data = await response.json();

            if (!data.success) {
                setMessage(data.error || 'Failed to add receptionist', 'error');
                return;
            }

            issued = { name: newReceptionist.name, email: newReceptionist.email, password: generatedPassword };
            setMessage(data.message, 'success');
            resetForm();
            await loadReceptionists();

        } catch (e) {
            console.error('Error adding receptionist:', e);
            setMessage(`Failed to add receptionist: ${e.message}`, 'error');
        } finally {
            isSubmitting = false;
        }
    }
    
    // Manual Password Reset
    async function handleManualPasswordReset(receptionist) {
        if (!confirm(`Generate a new password for ${receptionist.name}?`)) {
            return;
        }

        isSubmitting = true;
        try {
            const newPassword = generateSecurePassword();
            const res = await fetch('/api/receptionists/reset-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ receptionistId: receptionist.$id, newPassword })
            });
            const out = await res.json();
            if (!out.success) throw new Error(out.message || 'Reset failed');
            issued = { name: receptionist.name, email: receptionist.email, password: newPassword };

            setMessage(`Password reset successfully for ${receptionist.name}!`, 'success');
            
            // OPTIMIZED: Clear specific cache entry
            
            await loadReceptionists();

        } catch (e) {
            console.error('Failed to reset password:', e);
            setMessage('Failed to reset password. Check console for error details.', 'error');
        } finally {
            isSubmitting = false;
        }
    }
    
    // Edit Handlers
    
    function handleEdit(receptionist) {
        editingReceptionist = {...receptionist};
    }

    function closeEditModal() {
        editingReceptionist = null;
    }
    
    async function handleUpdateReceptionist() {
        if (!editingReceptionist.name || !editingReceptionist.departmentId || !editingReceptionist.email) {
            setMessage('Please fill in all required fields for update.', 'error');
            return;
        }

        isSubmitting = true;
        const docId = editingReceptionist.$id;

        try {
            const updateData = {
                name: editingReceptionist.name,
                email: editingReceptionist.email,
                departmentId: editingReceptionist.departmentId,
            };

            const result = await databases.updateDocument(
                VMS_DATABASE_ID,
                RECEPTIONIST_ID,
                docId,
                updateData
            );

            setMessage(`Receptionist ${result.name} updated successfully!`, 'success');
            closeEditModal();
            await loadReceptionists();

        } catch (e) {
            console.error('Update error:', e);
            setMessage('Failed to update receptionist. Check console for API error details.', 'error');
        } finally {
            isSubmitting = false;
        }
    }

    // Delete Handler - Call SvelteKit API endpoint
    
    async function handleDeleteReceptionist(receptionist) {
        if (!confirm(`Are you sure you want to delete ${receptionist.name}? This action cannot be undone.`)) {
            return;
        }

        isSubmitting = true;
        try {
            const response = await fetch('/api/receptionists/delete', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    receptionistId: receptionist.$id,
                    userId: receptionist.userId || null,
                    email: receptionist.email
                })
            });

            const data = await response.json();

            if (!data.success) {
                setMessage(data.error || 'Failed to delete receptionist', 'error');
                return;
            }

            setMessage(`Receptionist ${receptionist.name} deleted successfully.`, 'success');
            await loadReceptionists();

        } catch (e) {
            console.error('Failed to delete receptionist:', e);
            setMessage(`Failed to delete receptionist: ${e.message}`, 'error');
        } finally {
            isSubmitting = false;
        }
    }

    // OPTIMIZED: Parallel initialization
    onMount(async () => {
        await Promise.all([loadDepartments(), loadReceptionists()]);
    });
</script>

<svelte:head>
    <title>Manage Receptionists</title>
</svelte:head>

<!-- Main Page Container -->
<div class="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
    <header class="mb-8">
        <h1 class="text-4xl font-extrabold text-gray-900 mb-2">Receptionist Management</h1>
        <p class="text-gray-500">Add and manage staff authorized to handle visitor check-ins. Passwords are shown once when created or reset, then never stored in readable form.</p>
    </header>

    {#if issued}
        <div class="mb-6 rounded-xl border-2 border-amber-300 bg-amber-50 p-4" role="alert" data-testid="issued-password">
            <p class="font-semibold text-amber-900">Sign-in details for {issued.name}</p>
            <p class="text-sm text-amber-800">Copy the password now. It is not stored and cannot be shown again.</p>
            <div class="mt-2 flex flex-wrap items-center gap-2">
                <code class="break-all rounded bg-white px-3 py-1 font-mono text-sm">{issued.email}</code>
                <code class="break-all rounded bg-white px-3 py-1 font-mono text-sm">{issued.password}</code>
                <button class="rounded bg-amber-600 px-3 py-1 text-sm font-medium text-white" on:click={copyIssued}>{copied ? 'Copied' : 'Copy password'}</button>
                <button class="text-sm text-amber-900 underline" on:click={() => (issued = null)}>Done</button>
            </div>
        </div>
    {/if}

    {#if message.text}
        <div class="p-4 mb-6 rounded-xl text-sm font-medium {message.type === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-green-50 text-green-700 border border-green-200'}" role="alert">
            <div class="flex items-center">
                {#if message.type === 'error'} <XCircle class="w-5 h-5 mr-2" /> {/if}
                <span>{message.text}</span>
            </div>
        </div>
    {/if}

    <!-- 1. Add New Receptionist Form -->
    <div class="bg-white p-6 rounded-2xl shadow-xl mb-8">
        <h2 class="text-xl font-bold text-indigo-700 flex items-center mb-4 border-b pb-2">
            <UserPlus class="w-5 h-5 mr-2" />
            Add New Receptionist
        </h2>
        
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
            <!-- Name -->
            <div class="space-y-1">
                <label for="name" class="text-sm font-medium text-gray-700 flex items-center"><User class="w-4 h-4 mr-1" /> Full Name</label>
                <input 
                    type="text" 
                    id="name" 
                    bind:value={newReceptionist.name} 
                    class="w-full p-3 border border-gray-300 rounded-xl focus:ring-indigo-500 focus:border-indigo-500 transition"
                    placeholder="Jane Doe"
                />
            </div>

            <!-- Email (Username) -->
            <div class="space-y-1">
                <label for="email" class="text-sm font-medium text-gray-700 flex items-center"><Mail class="w-4 h-4 mr-1" /> Email Address</label>
                <input 
                    type="email" 
                    id="email" 
                    bind:value={newReceptionist.email} 
                    class="w-full p-3 border border-gray-300 rounded-xl focus:ring-indigo-500 focus:border-indigo-500 transition"
                    placeholder="jane.doe@company.com"
                />
            </div>

            <!-- Department -->
            <div class="space-y-1">
                <label for="department" class="text-sm font-medium text-gray-700 flex items-center"><Briefcase class="w-4 h-4 mr-1" /> Assigned Department</label>
                <select 
                    id="department" 
                    bind:value={newReceptionist.departmentId} 
                    class="w-full p-3 border border-gray-300 rounded-xl bg-white focus:ring-indigo-500 focus:border-indigo-500 transition"
                >
                    <option value="" disabled>Select Department</option>
                    {#each departments as dept (dept.$id)}
                        <option value={dept.$id}>{dept.name}</option>
                    {/each}
                    {#if departments.length === 0}
                        <option value="" disabled>Loading departments...</option>
                    {/if}
                </select>
            </div>
            
            <div class="md:col-span-3 flex justify-between items-center pt-4 border-t">
                <p class="text-sm text-gray-600 flex items-center">
                    <Key class="w-4 h-4 mr-2 text-indigo-600" />
                    Password will be auto-generated and receptionist added to team
                </p>
                <button 
                    on:click={handleAddReceptionist}
                    disabled={isSubmitting || isLoading}
                    class="px-6 py-3 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                >
                    {#if isSubmitting}
                        <RefreshCw class="w-5 h-5 mr-2 animate-spin" />
                        Adding...
                    {:else}
                        <UserPlus class="w-5 h-5 mr-2" />
                        Add Receptionist
                    {/if}
                </button>
            </div>
        </div>
    </div>

    <!-- 2. Existing Receptionists List -->
    <div class="bg-white p-6 rounded-2xl shadow-xl overflow-x-auto">
        <div class="flex justify-between items-center mb-4">
            <h2 class="text-xl font-bold text-gray-800">Existing Receptionists ({receptionists.length})</h2>
            <button on:click={loadReceptionists} disabled={isLoading || isSubmitting} class="text-indigo-600 hover:text-indigo-800 transition disabled:opacity-50">
                <RefreshCw class="w-5 h-5 {isLoading ? 'animate-spin' : ''}" />
            </button>
        </div>
        
        {#if isLoading && receptionists.length === 0}
            <div class="text-center p-10 text-gray-500">Loading receptionist data...</div>
        {:else if receptionists.length === 0}
            <div class="text-center p-10 text-gray-500">No receptionists found.</div>
        {:else}
            <table class="min-w-full divide-y divide-gray-200">
                <thead class="bg-gray-50">
                    <tr>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Department</th>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Password changed</th>
                        <th class="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                    </tr>
                </thead>
                <tbody class="bg-white divide-y divide-gray-200">
                    {#each receptionists as staff (staff.$id)}
                        <tr class="hover:bg-gray-50 transition duration-150">
                            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                {staff.name}
                            </td>
                            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                {staff.email}
                            </td>
                            <td class="px-6 py-4 whitespace-nowrap text-sm text-indigo-600">
                                {getDepartmentName(staff.departmentId)}
                            </td>
                            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                {staff.passwordLastReset ? new Date(staff.passwordLastReset).toLocaleDateString() : 'Set at creation'}
                            </td>
                            <td class="px-6 py-4 whitespace-nowrap text-center text-sm font-medium">
                                <div class="flex items-center justify-center gap-2">
                                    <button 
                                        on:click={() => handleEdit(staff)} 
                                        class="text-indigo-600 hover:text-indigo-800 transition p-2 rounded-full hover:bg-indigo-50"
                                        title="Edit Receptionist"
                                    >
                                        <Edit class="w-4 h-4" />
                                    </button>
                                    <button 
                                        on:click={() => handleManualPasswordReset(staff)} 
                                        class="text-orange-600 hover:text-orange-800 transition p-2 rounded-full hover:bg-orange-50"
                                        title="Reset Password Now"
                                        disabled={isSubmitting}
                                    >
                                        <Key class="w-4 h-4" />
                                    </button>
                                    <button 
                                        on:click={() => handleDeleteReceptionist(staff)} 
                                        class="text-red-600 hover:text-red-800 transition p-2 rounded-full hover:bg-red-50"
                                        title="Delete Receptionist"
                                        disabled={isSubmitting}
                                    >
                                        <Trash2 class="w-4 h-4" />
                                    </button>
                                </div>
                            </td>
                        </tr>
                    {/each}
                </tbody>
            </table>
        {/if}
    </div>
</div>

<!-- Edit Receptionist Modal -->
{#if editingReceptionist}
    <div class="fixed inset-0 bg-gray-900 bg-opacity-70 z-50 flex items-center justify-center p-4" on:click={closeEditModal}>
        <!-- Modal Content -->
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 relative" on:click|stopPropagation>
            <div class="flex justify-between items-center border-b pb-3 mb-4">
                <h3 class="text-2xl font-bold text-indigo-700 flex items-center">
                    <Edit class="w-6 h-6 mr-2" />
                    Edit Receptionist
                </h3>
                <button on:click={closeEditModal} class="text-gray-400 hover:text-gray-600 transition p-1">
                    <X class="w-6 h-6" />
                </button>
            </div>

            <div class="space-y-4">
                <!-- Name -->
                <div class="space-y-1">
                    <label for="edit-name" class="text-sm font-medium text-gray-700">Full Name</label>
                    <input 
                        type="text" 
                        id="edit-name" 
                        bind:value={editingReceptionist.name} 
                        class="w-full p-3 border border-gray-300 rounded-xl focus:ring-indigo-500 focus:border-indigo-500 transition"
                    />
                </div>

                <!-- Email -->
                <div class="space-y-1">
                    <label for="edit-email" class="text-sm font-medium text-gray-700">Email Address</label>
                    <input 
                        type="email" 
                        id="edit-email" 
                        bind:value={editingReceptionist.email} readonly 
                        class="w-full p-3 border border-gray-300 rounded-xl focus:ring-indigo-500 focus:border-indigo-500 transition"
                    />
                </div>

                <!-- Department -->
                <div class="space-y-1">
                    <label for="edit-department" class="text-sm font-medium text-gray-700">Assigned Department</label>
                    <select 
                        id="edit-department" 
                        bind:value={editingReceptionist.departmentId} 
                        class="w-full p-3 border border-gray-300 rounded-xl bg-white focus:ring-indigo-500 focus:border-indigo-500 transition"
                    >
                        <option value="" disabled>Select Department</option>
                        {#each departments as dept (dept.$id)}
                            <option value={dept.$id}>{dept.name}</option>
                        {/each}
                    </select>
                </div>

                <!-- Password Info -->
                <div class="pt-4 border-t border-gray-200 bg-blue-50 p-4 rounded-lg">
                    <p class="text-sm text-blue-800 mb-2 font-medium">Password Management</p>
                    <p class="text-xs text-blue-600 mb-3">
                        Passwords auto-reset every 2 months. Use the Reset Password button in the table to manually generate a new password.
                    </p>
                    <div class="flex items-center gap-2 text-xs">
                        <span class="text-gray-600">Last Reset:</span>
                        <span class="font-mono bg-white px-2 py-1 rounded">
                            {new Date(editingReceptionist.passwordLastReset).toLocaleDateString()}
                        </span>
                    </div>
                </div>
                
                <!-- Read-only Info -->
                <div class="pt-2 text-xs text-gray-500 border-t border-gray-100">
                    <p>Created: {new Date(editingReceptionist.createdAt).toLocaleString()}</p>
                    <p class="truncate">ID: {editingReceptionist.$id}</p>
                </div>

                <div class="flex justify-end pt-6 space-x-3">
                    <button 
                        on:click={closeEditModal}
                        class="px-4 py-2 bg-gray-200 text-gray-800 font-semibold rounded-xl hover:bg-gray-300 transition"
                    >
                        Cancel
                    </button>
                    <button 
                        on:click={handleUpdateReceptionist}
                        disabled={isSubmitting}
                        class="px-6 py-2 bg-green-600 text-white font-semibold rounded-xl hover:bg-green-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                    >
                        {#if isSubmitting}
                            <RefreshCw class="w-5 h-5 mr-2 animate-spin" />
                            Saving...
                        {:else}
                            <Save class="w-5 h-5 mr-2" />
                            Save Changes
                        {/if}
                    </button>
                </div>
            </div>
        </div>
    </div>
{/if}