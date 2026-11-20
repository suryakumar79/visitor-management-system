<script>
    import { onMount, onDestroy } from 'svelte';
    import { 
        databases, 
        realtime,
        VMS_DATABASE_ID, 
        DEPARTMENTS_COLLECTION_ID, 
        POSITIONS_COLLECTION_ID,
        STAFF_COLLECTION_ID,
        HR_CREDENTIALS_COLLECTION_ID,
        Query
    } from '$lib/client';

    let departments = [], positions = [], hrStaff = [], unassignedStaff = [];
    let hrCredentials = {}; // Map of staffId -> credentials
    
    // OPTIMIZED: Lookup maps for O(1) access
    let departmentsMap = new Map();
    let positionsMap = new Map();
    
    let staffToPromoteId = '', promoDepartmentId = '', promoPositionId = '';   
    let loading = true, submitting = false, message = { text: '', type: '' };
    let editingStaffId = null, editingStaff = { name: '', email: '', phone: '', departmentId: '', positionId: '' };
    let currentPage = 1, pageSize = 20, totalStaffRecords = 0;
    let sortOrder = 'added', filterName = '', filterDepartmentId = '', filterPositionId = '';
    // A password is shown once, right after it is set; it is never stored in readable form.
    let issued = null; // { name, email, password }
    let copied = false;
    
    // OPTIMIZED: Debounce timer
    let searchTimeout;
    
    let unsubscribeStaff = () => {}, unsubscribeHRCreds = () => {};

    $: totalPages = Math.ceil(totalStaffRecords / pageSize);

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

    function setMessage(text, type = 'error') {
        message = { text, type };
        setTimeout(() => message = { text: '', type: '' }, 6000);
    }

    // OPTIMIZED: Use Map lookups instead of .find()
    function getDeptName(deptId) { 
        return departmentsMap.get(deptId) || 'N/A'; 
    }
    
    function getPositionName(posId) { 
        return positionsMap.get(posId) || 'N/A'; 
    }
    
    async function copyIssued() {
        try { await navigator.clipboard.writeText(issued.password); copied = true; setTimeout(() => (copied = false), 2000); } catch { /* clipboard blocked */ }
    }

    // OPTIMIZED: Cached filtered positions
    $: promoFilteredPositions = promoDepartmentId 
        ? positions.filter(p => p.departmentId === promoDepartmentId)
        : [];
    
    $: filteredUnassignedStaff = unassignedStaff.filter(s => 
        (!promoDepartmentId || s.departmentId === promoDepartmentId) && 
        (!promoPositionId || s.positionId === promoPositionId)
    );
    
    $: filteredEditPositions = editingStaff.departmentId
        ? positions.filter(p => p.departmentId === editingStaff.departmentId)
        : [];
    
    $: if (promoDepartmentId && promoPositionId && !promoFilteredPositions.some(p => p.$id === promoPositionId)) {
        promoPositionId = '';
    }
    
    $: if (!filteredUnassignedStaff.some(s => s.$id === staffToPromoteId)) {
        staffToPromoteId = filteredUnassignedStaff.length > 0 ? filteredUnassignedStaff[0].$id : '';
    }

    async function loadHRCredentials() {
        try {
            const res = await databases.listDocuments(
                VMS_DATABASE_ID,
                HR_CREDENTIALS_COLLECTION_ID,
                [Query.limit(500)]
            );
            
            // OPTIMIZED: Build credentials map
            hrCredentials = {};
            res.documents.forEach(cred => {
                hrCredentials[cred.staffId] = cred;
            });
            
        } catch (error) {
            console.error('Failed to load HR credentials:', error);
        }
    }

    async function loadInitialData() {
        try {
            // OPTIMIZED: Parallel loading
            const [deptRes, posRes, unassignedRes] = await Promise.all([
                databases.listDocuments(VMS_DATABASE_ID, DEPARTMENTS_COLLECTION_ID, [
                    Query.limit(100)
                ]),
                databases.listDocuments(VMS_DATABASE_ID, POSITIONS_COLLECTION_ID, [
                    Query.limit(100)
                ]),
                databases.listDocuments(VMS_DATABASE_ID, STAFF_COLLECTION_ID, [
                    Query.equal('role', ['Staff']), 
                    Query.limit(300), 
                    Query.orderAsc('name')
                ])
            ]);

            departments = deptRes.documents;
            positions = posRes.documents;
            unassignedStaff = unassignedRes.documents;
            
            // OPTIMIZED: Build lookup maps
            departmentsMap = new Map(departments.map(d => [d.$id, d.name]));
            positionsMap = new Map(positions.map(p => [p.$id, p.name]));
            
            promoDepartmentId = departments[0]?.$id || '';
            
        } catch (error) {
            console.error('Failed to load initial data:', error);
            setMessage('Failed to load data.', 'error');
        }
    }
    
    async function loadHRStaff() {
        try {
            const queries = [
                Query.equal('role', ['HR']), 
                Query.limit(pageSize), 
                Query.offset((currentPage - 1) * pageSize)
            ];
            
            if (sortOrder === 'added') queries.push(Query.orderDesc('$createdAt'));
            else if (sortOrder === 'updated') queries.push(Query.orderDesc('$updatedAt'));

            const staffRes = await databases.listDocuments(
                VMS_DATABASE_ID, 
                STAFF_COLLECTION_ID, 
                queries
            );
            
            hrStaff = staffRes.documents;
            totalStaffRecords = staffRes.total;
            
            // Load credentials for current page
            await loadHRCredentials();
        } catch (error) {
            console.error('Failed to load HR staff:', error);
            setMessage('Failed to load HR staff.', 'error');
        } finally { 
            loading = false; 
        }
    }

    async function promoteStaffToHR() {
        if (!staffToPromoteId) { 
            setMessage('Please select staff.', 'error'); 
            return; 
        }
        
        submitting = true;
        message = { text: '', type: '' };

        const staffMember = unassignedStaff.find(s => s.$id === staffToPromoteId);
        if (!staffMember) { 
            setMessage('Staff not found.', 'error'); 
            submitting = false;
            return; 
        }

        const autoPassword = generateSecurePassword();

        try {
            const response = await fetch('/api/hr/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    staffDocumentId: staffMember.$id,
                    email: staffMember.email,
                    password: autoPassword
                })
            });

            const data = await response.json();
            
            if (data.success) {
                issued = { name: staffMember.name, email: staffMember.email, password: autoPassword };
                setMessage(`${staffMember.name} promoted to HR.`, 'success');
                promoDepartmentId = departments[0]?.$id || '';
                promoPositionId = '';
                
                // OPTIMIZED: Parallel reload
                await Promise.all([
                    loadInitialData(),
                    loadHRStaff()
                ]);
            } else {
                setMessage(`Failed: ${data.error || 'Unknown error'}`, 'error');
            }
        } catch (error) {
            console.error('Promotion failed:', error);
            setMessage(`Promotion failed: ${error.message}`, 'error');
        } finally { 
            submitting = false; 
        }
    }

    async function handleManualPasswordReset(staff) {
        const cred = hrCredentials[staff.$id];
        if (!cred || !cred.userId) {
            setMessage('Cannot reset: Missing credentials.', 'error');
            return;
        }
        if (!confirm(`Generate new password for ${staff.name}?`)) return;
        
        submitting = true;
        const newPassword = generateSecurePassword();

        try {
            const response = await fetch('/api/hr/reset-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    hrCredentialId: cred.$id,
                    userId: cred.userId,
                    newPassword: newPassword
                })
            });

            const data = await response.json();
            
            if (data.success) {
                issued = { name: staff.name, email: staff.email, password: newPassword };
                setMessage(`Password reset for ${staff.name}.`, 'success');
                await loadHRCredentials();
            } else {
                setMessage(`Reset failed: ${data.error}`, 'error');
            }
        } catch (e) {
            console.error('Reset failed:', e);
            setMessage(`Reset failed: ${e.message}`, 'error');
        } finally { 
            submitting = false; 
        }
    }

    async function handleDemote(staff) {
        const cred = hrCredentials[staff.$id];
        if (!cred || !cred.userId) { 
            setMessage('Cannot demote: Missing credentials.', 'error'); 
            return; 
        }
        if (!confirm(`Remove ${staff.name} from HR?`)) return;

        submitting = true;

        try {
            const response = await fetch('/api/hr/demote', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    staffDocumentId: staff.$id,
                    userId: cred.userId
                })
            });

            const data = await response.json();
            
            if (data.success) {
                setMessage(`${staff.name} demoted.`, 'success');
                await loadHRStaff();
            } else {
                setMessage(`Demotion failed: ${data.error}`, 'error');
            }
        } catch (error) {
            console.error('Demotion failed:', error);
            setMessage(`Demotion failed: ${error.message}`, 'error');
        } finally { 
            submitting = false; 
        }
    }

    function startEdit(staff) {
        editingStaffId = staff.$id;
        editingStaff = { 
            name: staff.name, 
            email: staff.email, 
            phone: staff.phone, 
            departmentId: staff.departmentId, 
            positionId: staff.positionId 
        };
    }

    function cancelEdit() { 
        editingStaffId = null; 
        editingStaff = {}; 
        message = { text: '', type: '' }; 
    }

    async function updateHRStaff() {
        const { name, email, phone, departmentId, positionId } = editingStaff;
        if (!name || !email || !phone || !departmentId || !positionId) { 
            setMessage('All fields required.', 'error'); 
            return; 
        }
        
        submitting = true;
        try {
            await databases.updateDocument(
                VMS_DATABASE_ID, 
                STAFF_COLLECTION_ID, 
                editingStaffId, 
                { name, email, phone, departmentId, positionId }
            );
            setMessage(`Updated!`, 'success');
            cancelEdit();
            await loadHRStaff();
        } catch (error) {
            console.error('Update failed:', error);
            setMessage('Update failed.', 'error');
        } finally { 
            submitting = false; 
        }
    }
    
    // OPTIMIZED: Debounced search with early return and pre-lowercasing
    function scheduleSearch() {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            filterName = filterName; // Trigger reactive
        }, 200);
    }

    $: filteredHRStaff = (() => {
        // Early return if no filters
        if (!filterName.trim() && !filterDepartmentId && !filterPositionId) {
            return hrStaff;
        }

        const search = filterName.toLowerCase().trim();
        
        return hrStaff.filter(staff => {
            // Early returns
            if (search && 
                !staff.name.toLowerCase().includes(search) && 
                !staff.email.toLowerCase().includes(search)) {
                return false;
            }
            if (filterDepartmentId && staff.departmentId !== filterDepartmentId) {
                return false;
            }
            if (filterPositionId && staff.positionId !== filterPositionId) {
                return false;
            }
            return true;
        });
    })();

    onMount(async () => {
        await loadInitialData();
        await loadHRStaff();
        
        unsubscribeStaff = realtime.subscribe(
            `databases.${VMS_DATABASE_ID}.collections.${STAFF_COLLECTION_ID}.documents`, 
            () => {
                loadInitialData();
                loadHRStaff(); 
            }
        );
        
        unsubscribeHRCreds = realtime.subscribe(
            `databases.${VMS_DATABASE_ID}.collections.${HR_CREDENTIALS_COLLECTION_ID}.documents`, 
            () => {
                loadHRCredentials();
            }
        );

        // Cleanup
        return () => {
            if (searchTimeout) clearTimeout(searchTimeout);
        };
    });

    onDestroy(() => { 
        if (typeof unsubscribeStaff === "function") unsubscribeStaff();
        if (typeof unsubscribeHRCreds === "function") unsubscribeHRCreds();
    });
</script>

<div class="p-6">
    <h1 class="text-3xl font-bold text-gray-800 mb-2">🧑‍💼 Manage HR Staff</h1>
    <p class="text-gray-500 mb-8">Promote staff to HR. A strong password is generated and shown once; it is not stored.</p>

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
        <div class="p-3 mb-6 rounded-lg text-sm font-medium border {message.type === 'error' ? 'bg-red-100 text-red-700 border-red-400' : 'bg-green-100 text-green-700 border-green-400'}" role="alert">
            {message.text}
        </div>
    {/if}

    <div class="bg-white p-6 rounded-xl shadow-2xl border-t-4 border-purple-600 mb-10">
        <h2 class="text-2xl font-semibold text-gray-700 mb-5">Promote Staff to HR</h2>
        {#if unassignedStaff.length === 0 && !loading}
            <div class="bg-gray-100 text-gray-600 p-3 rounded-lg border">All staff assigned.</div>
        {:else}
            <form on:submit|preventDefault={promoteStaffToHR} class="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                <select bind:value={promoDepartmentId} required class="p-3 border rounded-lg bg-white" disabled={submitting}>
                    <option value="" disabled>Select Department</option>
                    {#each departments as dept}<option value={dept.$id}>{dept.name}</option>{/each}
                </select>

                <select bind:value={promoPositionId} class="p-3 border rounded-lg bg-white" disabled={submitting || !promoDepartmentId}>
                    <option value="">Position (Optional)</option>
                    {#if !promoDepartmentId || promoFilteredPositions.length === 0}
                        <option disabled>No positions</option>
                    {:else}
                        {#each promoFilteredPositions as pos}
                            <option value={pos.$id}>{pos.name}</option>
                        {/each}
                    {/if}
                </select>
                
                <select bind:value={staffToPromoteId} required class="p-3 border rounded-lg bg-white" disabled={submitting || filteredUnassignedStaff.length === 0}>
                    <option value="" disabled>Select Staff</option>
                    {#if filteredUnassignedStaff.length === 0}
                        <option disabled>No staff found</option>
                    {:else}
                        {#each filteredUnassignedStaff as s}
                            <option value={s.$id}>{s.name} ({s.email})</option>
                        {/each}
                    {/if}
                </select>
                
                <button type="submit" class="py-3 px-4 bg-purple-600 text-white font-semibold rounded-lg hover:bg-purple-700 transition disabled:opacity-50" disabled={submitting || !staffToPromoteId}>
                    {submitting ? 'Promoting...' : 'Promote to HR'}
                </button>
            </form>
            <p class="text-xs text-gray-500 mt-3">🔑 A password is generated and shown once after promotion</p>
        {/if}
    </div>

    <div class="bg-white p-6 rounded-xl shadow-xl">
        <h2 class="text-2xl font-semibold text-gray-700 mb-5">HR Staff ({totalStaffRecords})</h2>
        
        <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <input 
                type="text" 
                bind:value={filterName} 
                on:input={scheduleSearch}
                placeholder="Search Name/Email" 
                class="p-2 border rounded-lg" 
            />
            <select bind:value={filterDepartmentId} on:change={loadHRStaff} class="p-2 border rounded-lg bg-white">
                <option value="">All Departments</option>
                {#each departments as dept}<option value={dept.$id}>{dept.name}</option>{/each}
            </select>
            <select bind:value={filterPositionId} on:change={loadHRStaff} class="p-2 border rounded-lg bg-white">
                <option value="">All Positions</option>
                {#each positions as pos}<option value={pos.$id}>{pos.name}</option>{/each}
            </select>
            <select bind:value={sortOrder} on:change={() => { currentPage = 1; loadHRStaff(); }} class="p-2 border rounded-lg bg-white">
                <option value="added">Latest Added</option>
                <option value="updated">Latest Updated</option>
            </select>
        </div>

        {#if loading && hrStaff.length === 0}
            <p class="text-center text-gray-500 py-8">Loading...</p>
        {:else if filteredHRStaff.length === 0}
            <p class="text-center text-gray-500 py-8">No HR staff found</p>
        {:else}
            <div class="overflow-x-auto">
                <table class="min-w-full divide-y divide-gray-200 text-sm">
                    <thead class="bg-gray-50">
                        <tr>
                            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Code</th>
                            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name/Email</th>
                            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Phone</th>
                            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Dept/Position</th>
                            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Password</th>
                            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                            <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                        </tr>
                    </thead>
                    <tbody class="bg-white divide-y divide-gray-200">
                        {#each filteredHRStaff as staff (staff.$id)}
                            {@const cred = hrCredentials[staff.$id]}
                            <tr>
                                {#if editingStaffId === staff.$id}
                                    <td class="px-4 py-3"><span class="font-mono text-xs bg-gray-100 px-2 py-1 rounded">{staff.employeeCode || 'N/A'}</span></td>
                                    <td class="px-4 py-3">
                                        <input type="text" bind:value={editingStaff.name} class="p-2 border rounded w-full mb-1" />
                                        <input type="email" bind:value={editingStaff.email} class="p-2 border rounded w-full text-xs" />
                                    </td>
                                    <td class="px-4 py-3"><input type="tel" bind:value={editingStaff.phone} class="p-2 border rounded w-full" /></td>
                                    <td class="px-4 py-3 space-y-1">
                                        <select bind:value={editingStaff.departmentId} class="p-2 border rounded w-full text-xs">
                                            {#each departments as dept}<option value={dept.$id}>{dept.name}</option>{/each}
                                        </select>
                                        <select bind:value={editingStaff.positionId} class="p-2 border rounded w-full text-xs">
                                            {#if filteredEditPositions.length === 0}
                                                <option disabled>No positions</option>
                                            {:else}
                                                {#each filteredEditPositions as pos}
                                                    <option value={pos.$id}>{pos.name}</option>
                                                {/each}
                                            {/if}
                                        </select>
                                    </td>
                                    <td colspan="3" class="px-4 py-3">
                                        <button on:click={updateHRStaff} class="text-green-600 hover:text-green-900 font-bold mr-2">Save</button>
                                        <button on:click={cancelEdit} class="text-gray-500 hover:text-gray-700">Cancel</button>
                                    </td>
                                {:else}
                                    <td class="px-4 py-3"><span class="font-mono text-xs font-semibold bg-indigo-50 text-indigo-700 px-2 py-1 rounded">{staff.employeeCode || 'N/A'}</span></td>
                                    <td class="px-4 py-3">{staff.name}<span class="block text-xs text-gray-400">{staff.email}</span></td>
                                    <td class="px-4 py-3">{staff.phone}</td>
                                    <td class="px-4 py-3"><span class="font-semibold">{getPositionName(staff.positionId)}</span><span class="block text-xs text-gray-400">{getDeptName(staff.departmentId)}</span></td>
                                    <td class="px-4 py-3">
                                        {#if cred}
                                            <span class="text-xs text-gray-500">Changed {cred.hrPasswordLastReset ? new Date(cred.hrPasswordLastReset).toLocaleDateString() : 'at creation'}</span>
                                        {:else}
                                            <span class="text-xs text-gray-400">No credentials</span>
                                        {/if}
                                    </td>
                                    <td class="px-4 py-3"><span class="rounded-full bg-green-100 px-2 py-1 text-xs text-green-700">Active</span></td>
                                    <td class="px-4 py-3 space-x-1">
                                        <button on:click={() => startEdit(staff)} class="text-indigo-600 hover:text-indigo-900 text-xs font-bold">Edit</button>
                                        <button on:click={() => handleManualPasswordReset(staff)} class="text-orange-600 hover:text-orange-900 text-xs font-bold" disabled={submitting || !cred}>Reset</button>
                                        <button on:click={() => handleDemote(staff)} class="text-red-600 hover:text-red-900 text-xs font-bold" disabled={submitting}>Remove</button>
                                    </td>
                                {/if}
                            </tr>
                        {/each}
                    </tbody>
                </table>
            </div>
            
            {#if totalStaffRecords > pageSize}
                <div class="flex justify-between items-center mt-6 border-t pt-4">
                    <p class="text-sm text-gray-700">Showing {(currentPage - 1) * pageSize + 1} to {(currentPage - 1) * pageSize + hrStaff.length} of {totalStaffRecords}</p>
                    <nav class="inline-flex rounded-md shadow-sm -space-x-px">
                        <button on:click={() => { if (currentPage > 1) { currentPage--; loadHRStaff(); } }} disabled={currentPage === 1} class="px-3 py-2 rounded-l-md border bg-white text-sm text-gray-500 hover:bg-gray-50 disabled:opacity-50">Prev</button>
                        {#each Array(totalPages) as _, i}
                            <button on:click={() => { currentPage = i + 1; loadHRStaff(); }} class="hidden md:inline-flex px-4 py-2 border text-sm {currentPage === i + 1 ? 'bg-indigo-50 border-indigo-500 text-indigo-600' : 'bg-white text-gray-700 hover:bg-gray-50'}">{i + 1}</button>
                        {/each}
                        <button on:click={() => { if (currentPage < totalPages) { currentPage++; loadHRStaff(); } }} disabled={currentPage === totalPages} class="px-3 py-2 rounded-r-md border bg-white text-sm text-gray-500 hover:bg-gray-50 disabled:opacity-50">Next</button>
                    </nav>
                </div>
            {/if}
        {/if}
    </div>
</div>