<script>
    import { onMount, onDestroy } from 'svelte';
    import { 
        databases, 
        realtime,
        ID, 
        VMS_DATABASE_ID, 
        DEPARTMENTS_COLLECTION_ID, 
        POSITIONS_COLLECTION_ID,
        STAFF_COLLECTION_ID,
        Query
    } from '$lib/client';
    import { UserPlus, User, Mail, Phone, Briefcase, AlertTriangle, Trash2, Edit, Save, XCircle, RefreshCw, X, CheckCircle } from 'lucide-svelte';

    // Configuration
    // Data State
    let departments = [];
    let positions = [];
    let staffList = []; 
    
    // OPTIMIZED: Lookup maps for O(1) access
    let departmentsMap = new Map();
    let positionsMap = new Map();
    
    // Form State
    let newStaff = {
        name: '',
        employeeCode: '', 
        email: '',
        phone: '+91', 
        departmentId: '',
        positionId: ''
    };
    
    // UI State
    let loading = true;
    let submitting = false;
    let message = { text: '', type: '' };

    // Editing State
    let editingStaffId = null;
    let editingStaff = { 
        name: '', 
        employeeCode: '', 
        email: '', 
        phone: '', 
        departmentId: '', 
        positionId: '' 
    };

    // Relieve Staff State
    let showReliefModal = false;
    let staffToRelieve = null;

    // Pagination State
    let currentPage = 1;
    const pageSize = 30; 
    let totalStaffRecords = 0;
    
    // Sorting/Filtering State
    let sortOrder = 'added'; 
    let filterName = ''; 
    let filterDepartmentId = '';
    let filterPositionId = '';

    // OPTIMIZED: Debounce timer for search
    let searchTimeout;

    // Real-time listener cleanup
    let unsubscribeStaff = () => {}; 

    // Pagination & Sorting Handlers
    $: totalPages = Math.ceil(totalStaffRecords / pageSize);

    function changePage(page) {
        if (page >= 1 && page <= totalPages && page !== currentPage) {
            currentPage = page;
            loadStaff(); 
        }
    }
    
    function handleSortChange() {
        currentPage = 1;
        loadStaff();
    }
    
    function handleServerFilterChange() {
        currentPage = 1; 
        loadStaff();
    }

    // Utility Functions

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

    // OPTIMIZED: Cached filtered positions
    $: creationFilteredPositions = newStaff.departmentId && positions.length > 0
        ? positions.filter(p => p.departmentId === newStaff.departmentId) 
        : [];
    
    $: editFilteredPositions = editingStaff.departmentId && positions.length > 0
        ? positions.filter(p => p.departmentId === editingStaff.departmentId) 
        : [];

    // ADDED: Phone validation function
    function isValidPhoneNumber(phone) {
        if (!phone) return false;
        
        const cleaned = phone.replace(/\D/g, '');
        
        if (phone.startsWith('+91')) {
            // Should be +91 followed by exactly 10 digits
            const afterCode = phone.slice(3).replace(/\D/g, '');
            return afterCode.length === 10;
        } else if (cleaned.startsWith('91')) {
            // Should be 91 followed by exactly 10 digits (total 12)
            return cleaned.length === 12;
        }
        
        // Generic validation for other country codes
        return cleaned.length >= 10 && cleaned.length <= 15;
    }

    // ADDED: Phone input handler for new staff
    function handleNewStaffPhoneInput(event) {
        let value = event.target.value;
        
        if (!value || value === '+') {
            newStaff.phone = '+91';
            return;
        }
        
        // Remove all non-digits except +
        const digitsOnly = value.replace(/[^\d+]/g, '');
        
        if (digitsOnly === '+91' || digitsOnly === '+') {
            newStaff.phone = '+91';
        } else if (!digitsOnly.startsWith('+91')) {
            const cleanDigits = digitsOnly.replace(/^\+?91/, '');
            newStaff.phone = '+91' + cleanDigits;
        } else {
            newStaff.phone = digitsOnly;
        }
        
        // Limit to +91 + 10 digits = 13 characters
        if (newStaff.phone.length > 13) {
            newStaff.phone = newStaff.phone.slice(0, 13);
        }
    }

    // ADDED: Phone input handler for editing staff
    function handleEditStaffPhoneInput(event) {
        let value = event.target.value;
        
        if (!value || value === '+') {
            editingStaff.phone = '+91';
            return;
        }
        
        const digitsOnly = value.replace(/[^\d+]/g, '');
        
        if (digitsOnly === '+91' || digitsOnly === '+') {
            editingStaff.phone = '+91';
        } else if (!digitsOnly.startsWith('+91')) {
            const cleanDigits = digitsOnly.replace(/^\+?91/, '');
            editingStaff.phone = '+91' + cleanDigits;
        } else {
            editingStaff.phone = digitsOnly;
        }
        
        if (editingStaff.phone.length > 13) {
            editingStaff.phone = editingStaff.phone.slice(0, 13);
        }
    }

    // Data Loading

    async function loadInitialData() {
        try {
            // OPTIMIZED: Parallel loading
            const [deptResponse, posResponse] = await Promise.all([
                databases.listDocuments(VMS_DATABASE_ID, DEPARTMENTS_COLLECTION_ID, [
                    Query.limit(100)
                ]),
                databases.listDocuments(VMS_DATABASE_ID, POSITIONS_COLLECTION_ID, [
                    Query.limit(100)
                ])
            ]);

            departments = deptResponse.documents;
            positions = posResponse.documents;

            // OPTIMIZED: Build lookup maps
            departmentsMap = new Map(departments.map(d => [d.$id, d.name]));
            positionsMap = new Map(positions.map(p => [p.$id, p.name]));

        } catch (error) {
            console.error('Failed to load initial data:', error);
            setMessage('Failed to load departments/positions.', 'error');
        }
    }
    
    async function loadStaff() {
        loading = true;
        try {
            const queries = [
                Query.notEqual('role', 'HR'),
                Query.equal('status', 'active'), // Only active staff
                Query.limit(pageSize),
                Query.offset((currentPage - 1) * pageSize)
            ];

            if (filterDepartmentId) {
                queries.push(Query.equal('departmentId', filterDepartmentId));
            }
            
            if (filterPositionId) {
                queries.push(Query.equal('positionId', filterPositionId));
            }

            if (sortOrder === 'added') {
                queries.push(Query.orderDesc('$createdAt'));
            } else if (sortOrder === 'updated') {
                queries.push(Query.orderDesc('$updatedAt'));
            }

            const staffResponse = await databases.listDocuments(
                VMS_DATABASE_ID,
                STAFF_COLLECTION_ID,
                queries
            );
            
            staffList = staffResponse.documents;
            totalStaffRecords = staffResponse.total;
        } catch (error) {
            console.error('Failed to load staff list:', error);
            setMessage('Failed to load staff list. Please try again.', 'error');
        } finally {
            loading = false;
        }
    }

    // Lifecycle
    onMount(async () => {
        await loadInitialData();
        await loadStaff();

        try {
            unsubscribeStaff = realtime.subscribe(
                `databases.${VMS_DATABASE_ID}.collections.${STAFF_COLLECTION_ID}.documents`,
                (response) => {
                    loadStaff(); 
                }
            );
        } catch (rtError) {
            console.warn("Realtime connection warning:", rtError);
        }

        // Cleanup
        return () => {
            if (searchTimeout) clearTimeout(searchTimeout);
        };
    });

    onDestroy(() => {
        if (typeof unsubscribeStaff === "function") {
            unsubscribeStaff(); 
        }
    });

    // Actions: Create

    async function createStaff() {
        // ENHANCED: Better validation with phone check
        if (!newStaff.name || !newStaff.employeeCode || !newStaff.email || !newStaff.departmentId || !newStaff.positionId) {
            setMessage('Please fill all required fields.', 'error');
            return;
        }

        // ADDED: Validate phone number
        if (!isValidPhoneNumber(newStaff.phone)) {
            const digitsAfter91 = newStaff.phone.slice(3).replace(/\D/g, '');
            if (digitsAfter91.length < 10) {
                setMessage(`Invalid phone number. You have entered ${digitsAfter91.length} digit${digitsAfter91.length !== 1 ? 's' : ''}. Please enter a complete 10-digit mobile number.`, 'error');
            } else {
                setMessage('Please enter a valid 10-digit mobile number.', 'error');
            }
            return;
        }

        submitting = true;
        message = { text: '', type: '' };
        
        try {
            const existing = await databases.listDocuments(
                VMS_DATABASE_ID,
                STAFF_COLLECTION_ID,
                [Query.equal('employeeCode', newStaff.employeeCode)]
            );
            
            if (existing.total > 0) {
                 setMessage('A staff member with this Employee Code already exists.', 'error');
                 return;
            }

            const documentData = {
                ...newStaff,
                role: 'Staff',
                status: 'active' 
            };

            await databases.createDocument(
                VMS_DATABASE_ID,
                STAFF_COLLECTION_ID,
                ID.unique(), 
                documentData
            );
            
            setMessage(`Staff member ${newStaff.name} created successfully!`, 'success');
            newStaff = { name: '', employeeCode: '', email: '', phone: '+91', departmentId: '', positionId: '' };
            
            if (currentPage === 1) loadStaff();

        } catch (error) {
            console.error('Staff creation failed:', error);
            setMessage(`Creation failed. Error: ${error.message}`, 'error');
        } finally {
            submitting = false;
        }
    }

    // Actions: Update
    
    function startEdit(staff) {
        editingStaffId = staff.$id;
        const staffPhone = staff.phone || '+91';
        editingStaff = { 
            name: staff.name, 
            email: staff.email, 
            phone: staffPhone,
            employeeCode: staff.employeeCode, 
            departmentId: staff.departmentId, 
            positionId: staff.positionId 
        };
    }

    function cancelEdit() {
        editingStaffId = null;
        editingStaff = {};
        message = { text: '', type: '' };
    }

    async function updateStaff() {
        // ADDED: Validate phone on update
        if (!isValidPhoneNumber(editingStaff.phone)) {
            const digitsAfter91 = editingStaff.phone.slice(3).replace(/\D/g, '');
            if (digitsAfter91.length < 10) {
                setMessage(`Invalid phone number. You have entered ${digitsAfter91.length} digit${digitsAfter91.length !== 1 ? 's' : ''}. Please enter a complete 10-digit mobile number.`, 'error');
            } else {
                setMessage('Please enter a valid 10-digit mobile number.', 'error');
            }
            return;
        }

        submitting = true;
        try {
            await databases.updateDocument(
                VMS_DATABASE_ID,
                STAFF_COLLECTION_ID,
                editingStaffId,
                editingStaff
            );
            setMessage(`Staff member updated successfully!`, 'success');
            cancelEdit();
        } catch (error) {
            console.error('Update failed:', error);
            setMessage('Failed to update staff member.', 'error');
        } finally {
            submitting = false;
        }
    }

    // Actions: Relieve

    function startRelieve(staff) {
        staffToRelieve = staff;
        showReliefModal = true;
    }

    function cancelRelieve() {
        showReliefModal = false;
        staffToRelieve = null;
    }

    async function relieveStaff() {
        if (!staffToRelieve) return;
        submitting = true;
        
        try {
            await databases.updateDocument(
                VMS_DATABASE_ID,
                STAFF_COLLECTION_ID,
                staffToRelieve.$id,
                { status: 'exstaff' }
            );

            setMessage(`Staff member ${staffToRelieve.name} marked as Ex-Staff.`, 'success');
            cancelRelieve();
            loadStaff(); 
        } catch (error) {
            console.error('Staff relief failed:', error);
            setMessage('Failed to update staff status.', 'error');
        } finally {
            submitting = false;
        }
    }

    // OPTIMIZED: Debounced client-side search with early return and pre-lowercasing
    function scheduleSearch() {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            // Trigger reactive statement
            filterName = filterName;
        }, 200);
    }

    $: filteredStaff = (() => {
        // Early return if no search
        if (!filterName.trim()) return staffList;

        const search = filterName.toLowerCase().trim();
        
        return staffList.filter(staff => {
            const staffName = (staff.name || '').toLowerCase();
            const staffCode = String(staff.employeeCode || '').toLowerCase();
            const staffEmail = (staff.email || '').toLowerCase();

            // Early return on first match
            return staffName.includes(search) || 
                   staffCode.includes(search) || 
                   staffEmail.includes(search);
        });
    })();
</script>

<div class="p-6 min-h-screen bg-gray-50">
    <h1 class="text-3xl font-bold text-gray-800 mb-8 flex items-center">
        <User class="w-8 h-8 mr-3 text-indigo-600" />
        Manage General Staff
    </h1>

    {#if message.text}
        <div class="p-4 mb-6 rounded-xl text-sm font-medium shadow-sm flex items-center
            {message.type === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-green-50 text-green-700 border border-green-200'}">
            {#if message.type === 'error'}<AlertTriangle class="w-5 h-5 mr-2"/>{:else}<CheckCircle class="w-5 h-5 mr-2"/>{/if}
            {message.text}
        </div>
    {/if}

    <!-- Add New Staff Form -->
    <div class="bg-white p-6 rounded-2xl shadow-lg border-t-4 border-blue-600 mb-10">
        <h2 class="text-xl font-bold text-gray-800 mb-4 flex items-center">
            <UserPlus class="w-5 h-5 mr-2 text-blue-600" /> Add New Staff
        </h2>
        
        <form on:submit|preventDefault={createStaff} class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <input type="text" bind:value={newStaff.name} placeholder="Full Name" required class="p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition" disabled={submitting} />
            <input type="text" bind:value={newStaff.employeeCode} placeholder="Employee Code" required class="p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition" disabled={submitting} />
            <input type="email" bind:value={newStaff.email} placeholder="Email" required class="p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition" disabled={submitting} />
            <input 
                type="tel" 
                bind:value={newStaff.phone} 
                on:input={handleNewStaffPhoneInput}
                placeholder="+91 Phone" 
                required 
                maxlength="13" 
                class="p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition" 
                disabled={submitting} 
            />

            <select bind:value={newStaff.departmentId} required class="p-3 border border-gray-300 rounded-xl bg-white focus:ring-2 focus:ring-blue-500 outline-none transition" disabled={submitting}>
                <option value="" disabled selected>Select Department</option>
                {#each departments as dept}
                    <option value={dept.$id}>{dept.name}</option>
                {/each}
            </select>
            
            <select bind:value={newStaff.positionId} required class="p-3 border border-gray-300 rounded-xl bg-white focus:ring-2 focus:ring-blue-500 outline-none transition" disabled={submitting || creationFilteredPositions.length === 0}>
                <option value="" disabled selected>Select Position</option>
                {#each creationFilteredPositions as pos}
                    <option value={pos.$id}>{pos.name}</option>
                {/each}
            </select>
            
            <div class="lg:col-span-3 flex justify-end">
                <button type="submit" class="px-6 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center" disabled={submitting}>
                    {#if submitting}<RefreshCw class="w-5 h-5 mr-2 animate-spin"/>{:else}<UserPlus class="w-5 h-5 mr-2"/>{/if}
                    Add Staff Member
                </button>
            </div>
        </form>
    </div>

    <!-- Staff List -->
    <div class="bg-white p-6 rounded-2xl shadow-lg">
        <div class="flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
            <h2 class="text-xl font-bold text-gray-800 flex items-center">
                <Briefcase class="w-5 h-5 mr-2 text-gray-600" /> Active Staff List ({totalStaffRecords})
            </h2>
            <div class="flex gap-2 w-full md:w-auto">
                <button on:click={loadStaff} class="p-2 text-gray-500 hover:text-blue-600 transition rounded-full hover:bg-blue-50" title="Refresh List">
                    <RefreshCw class="w-5 h-5 {loading ? 'animate-spin' : ''}" />
                </button>
            </div>
        </div>
        
        <!-- Filters -->
        <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6 bg-gray-50 p-4 rounded-xl border border-gray-100">
            <input 
                type="text" 
                bind:value={filterName} 
                on:input={scheduleSearch}
                placeholder="Search Name/Code..." 
                class="w-full p-2 border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500" 
            />
            
            <select bind:value={filterDepartmentId} on:change={handleServerFilterChange} class="w-full p-2 border border-gray-300 rounded-lg bg-white">
                <option value="">All Departments</option>
                {#each departments as dept}<option value={dept.$id}>{dept.name}</option>{/each}
            </select>
            
            <select bind:value={filterPositionId} on:change={handleServerFilterChange} class="w-full p-2 border border-gray-300 rounded-lg bg-white">
                <option value="">All Positions</option>
                {#if filterDepartmentId}
                    {#each positions.filter(p => p.departmentId === filterDepartmentId) as pos}<option value={pos.$id}>{pos.name}</option>{/each}
                {/if}
            </select>
            
            <select bind:value={sortOrder} on:change={handleSortChange} class="w-full p-2 border border-gray-300 rounded-lg bg-white">
                <option value="added">Latest Added</option>
                <option value="updated">Latest Updated</option>
            </select>
        </div>

        {#if loading && staffList.length === 0}
            <div class="text-center py-12 text-gray-500">Loading staff data...</div>
        {:else if staffList.length === 0}
            <div class="text-center py-12 text-gray-500 bg-gray-50 rounded-xl">No active staff members found matching your criteria.</div>
        {:else}
            <div class="overflow-x-auto rounded-xl border border-gray-200">
                <table class="min-w-full divide-y divide-gray-200">
                    <thead class="bg-gray-100">
                        <tr>
                            <th class="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Employee</th>
                            <th class="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Contact</th>
                            <th class="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Role</th>
                            <th class="px-6 py-3 text-right text-xs font-bold text-gray-500 uppercase tracking-wider">Actions</th>
                        </tr>
                    </thead>
                    <tbody class="bg-white divide-y divide-gray-200">
                        {#each filteredStaff as staff (staff.$id)}
                            <tr class="hover:bg-blue-50 transition">
                                {#if editingStaffId === staff.$id}
                                    <!-- Editing Row -->
                                    <td class="px-6 py-4">
                                        <input type="text" bind:value={editingStaff.name} class="w-full p-1 border rounded text-sm mb-1" placeholder="Name" />
                                        <input type="text" bind:value={editingStaff.employeeCode} class="w-full p-1 border rounded text-xs bg-gray-50" placeholder="Code" />
                                    </td>
                                    <td class="px-6 py-4">
                                        <input type="email" bind:value={editingStaff.email} class="w-full p-1 border rounded text-sm mb-1" placeholder="Email" />
                                        <input 
                                            type="tel" 
                                            bind:value={editingStaff.phone} 
                                            on:input={handleEditStaffPhoneInput}
                                            maxlength="13"
                                            class="w-full p-1 border rounded text-sm" 
                                            placeholder="Phone" 
                                        />
                                    </td>
                                    <td class="px-6 py-4">
                                        <select bind:value={editingStaff.departmentId} class="w-full p-1 border rounded text-sm mb-1">
                                            {#each departments as d}<option value={d.$id}>{d.name}</option>{/each}
                                        </select>
                                        <select bind:value={editingStaff.positionId} class="w-full p-1 border rounded text-sm">
                                            {#each editFilteredPositions as p}<option value={p.$id}>{p.name}</option>{/each}
                                        </select>
                                    </td>
                                    <td class="px-6 py-4 text-right space-x-2">
                                        <button on:click={updateStaff} class="text-green-600 hover:text-green-800 font-bold text-xs uppercase"><Save class="w-4 h-4 inline"/> Save</button>
                                        <button on:click={cancelEdit} class="text-gray-500 hover:text-gray-700 font-bold text-xs uppercase"><XCircle class="w-4 h-4 inline"/> Cancel</button>
                                    </td>
                                {:else}
                                    <!-- Display Row -->
                                    <td class="px-6 py-4">
                                        <div class="text-sm font-bold text-gray-900">{staff.name}</div>
                                        <div class="text-xs text-indigo-600 font-mono">{staff.employeeCode}</div>
                                    </td>
                                    <td class="px-6 py-4">
                                        <div class="text-sm text-gray-600">{staff.email}</div>
                                        <div class="text-xs text-gray-500">{staff.phone}</div>
                                    </td>
                                    <td class="px-6 py-4">
                                        <div class="text-sm font-medium text-gray-800">{getPositionName(staff.positionId)}</div>
                                        <div class="text-xs text-gray-500">{getDeptName(staff.departmentId)}</div>
                                    </td>
                                    <td class="px-6 py-4 text-right whitespace-nowrap">
                                        <button on:click={() => startEdit(staff)} class="text-indigo-600 hover:text-indigo-900 bg-indigo-50 hover:bg-indigo-100 p-2 rounded-lg mr-2 transition" title="Edit">
                                            <Edit class="w-4 h-4" />
                                        </button>
                                        <button on:click={() => startRelieve(staff)} class="text-red-600 hover:text-red-900 bg-red-50 hover:bg-red-100 p-2 rounded-lg transition" title="Relieve Staff">
                                            <Trash2 class="w-4 h-4" />
                                        </button>
                                    </td>
                                {/if}
                            </tr>
                        {/each}
                    </tbody>
                </table>
            </div>
            
            <!-- Pagination -->
            {#if totalStaffRecords > pageSize}
                <div class="flex justify-between items-center mt-6 pt-4 border-t border-gray-200">
                    <span class="text-sm text-gray-600">Page {currentPage} of {totalPages}</span>
                    <div class="flex space-x-2">
                        <button on:click={() => changePage(currentPage - 1)} disabled={currentPage === 1} class="px-3 py-1 rounded border hover:bg-gray-100 disabled:opacity-50">Prev</button>
                        <button on:click={() => changePage(currentPage + 1)} disabled={currentPage === totalPages} class="px-3 py-1 rounded border hover:bg-gray-100 disabled:opacity-50">Next</button>
                    </div>
                </div>
            {/if}
        {/if}
    </div>
</div>

<!-- Relieve Confirmation Modal -->
{#if showReliefModal && staffToRelieve}
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900 bg-opacity-75 backdrop-blur-sm">
        <div class="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 transform transition-all scale-100">
            <div class="flex items-center justify-center w-12 h-12 mx-auto bg-red-100 rounded-full mb-4">
                <AlertTriangle class="w-6 h-6 text-red-600" />
            </div>
            <h3 class="text-lg font-bold text-center text-gray-900 mb-2">Relieve Staff Member?</h3>
            <p class="text-sm text-center text-gray-500 mb-6">
                Are you sure you want to mark <strong>{staffToRelieve.name}</strong> (ID: {staffToRelieve.employeeCode}) as Ex-Staff? 
                <br/><br/>
                This will change their status to <span class="font-mono text-red-600 bg-red-50 px-1 rounded">exstaff</span> and hide them from the active list.
            </p>
            <div class="flex space-x-3">
                <button on:click={cancelRelieve} class="flex-1 px-4 py-2 bg-gray-100 text-gray-700 font-semibold rounded-xl hover:bg-gray-200 transition">Cancel</button>
                <button on:click={relieveStaff} disabled={submitting} class="flex-1 px-4 py-2 bg-red-600 text-white font-semibold rounded-xl hover:bg-red-700 transition disabled:opacity-50">
                    {submitting ? 'Processing...' : 'Confirm Relief'}
                </button>
            </div>
        </div>
    </div>
{/if}