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
    import { 
        UserX, Search, UserCheck, AlertTriangle, RefreshCw, 
        ChevronLeft, ChevronRight, UserCog, Briefcase, CheckCircle, XCircle 
    } from 'lucide-svelte';

    // Configuration
    // Data State
    let departments = [];
    let positions = [];
    let staffList = []; 
    
    // OPTIMIZED: Lookup maps for O(1) access
    let departmentsMap = new Map();
    let positionsMap = new Map();
    
    // UI State
    let loading = true;
    let submitting = false;
    let message = { text: '', type: '' };

    // Activate Staff State
    let showActivateModal = false;
    let staffToActivate = null;

    // Pagination State
    let currentPage = 1;
    const pageSize = 30; 
    let totalStaffRecords = 0;
    
    // Filtering State
    let filterName = ''; 
    let filterDepartmentId = '';
    let filterPositionId = '';

    // OPTIMIZED: Debounce timer
    let searchTimeout;

    let unsubscribeStaff = () => {}; 

    // Pagination Computed
    $: totalPages = Math.ceil(totalStaffRecords / pageSize);

    function changePage(page) {
        if (page >= 1 && page <= totalPages && page !== currentPage) {
            currentPage = page;
            loadExStaff(); 
        }
    }
    
    function handleServerFilterChange() {
        currentPage = 1; 
        loadExStaff();
    }

    // Helpers
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
    
    async function loadExStaff() {
        loading = true;
        try {
            const queries = [
                Query.equal('status', 'exstaff'), // Only ex-staff
                Query.limit(pageSize),
                Query.offset((currentPage - 1) * pageSize),
                Query.orderDesc('$updatedAt') // Recently relieved first
            ];

            if (filterDepartmentId) {
                queries.push(Query.equal('departmentId', filterDepartmentId));
            }
            
            if (filterPositionId) {
                queries.push(Query.equal('positionId', filterPositionId));
            }

            const staffResponse = await databases.listDocuments(
                VMS_DATABASE_ID,
                STAFF_COLLECTION_ID,
                queries
            );
            
            staffList = staffResponse.documents;
            totalStaffRecords = staffResponse.total;
        } catch (error) {
            console.error('Failed to load ex-staff list:', error);
            setMessage('Failed to load list. Ensure "status" index exists.', 'error');
        } finally {
            loading = false;
        }
    }

    // Lifecycle
    onMount(async () => {
        await loadInitialData();
        await loadExStaff();

        try {
            unsubscribeStaff = realtime.subscribe(
                `databases.${VMS_DATABASE_ID}.collections.${STAFF_COLLECTION_ID}.documents`,
                (response) => {
                    loadExStaff(); 
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

    // Actions: Re-Activate Staff

    function startActivate(staff) {
        staffToActivate = staff;
        showActivateModal = true;
    }

    function cancelActivate() {
        showActivateModal = false;
        staffToActivate = null;
    }

    async function activateStaff() {
        if (!staffToActivate) return;
        submitting = true;
        
        try {
            // Update status back to 'active'
            await databases.updateDocument(
                VMS_DATABASE_ID,
                STAFF_COLLECTION_ID,
                staffToActivate.$id,
                { status: 'active' }
            );

            setMessage(`Staff member ${staffToActivate.name} has been reactivated successfully.`, 'success');
            cancelActivate();
            loadExStaff(); 
        } catch (error) {
            console.error('Reactivation failed:', error);
            setMessage('Failed to reactivate staff member.', 'error');
        } finally {
            submitting = false;
        }
    }

    // OPTIMIZED: Debounced client-side search with early return
    function scheduleSearch() {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            filterName = filterName; // Trigger reactive
        }, 200);
    }

    $: filteredStaff = (() => {
        // Early return if no search
        if (!filterName.trim()) return staffList;

        const search = filterName.toLowerCase().trim();
        
        return staffList.filter(staff => {
            const staffName = (staff.name || '').toLowerCase();
            const staffCode = String(staff.employeeCode || '').toLowerCase();
            
            // Early return on first match
            return staffName.includes(search) || staffCode.includes(search);
        });
    })();
</script>

<svelte:head>
    <title>Ex-Staff Management</title>
</svelte:head>

<div class="p-6 min-h-screen bg-gray-50">
    <h1 class="text-3xl font-bold text-gray-800 mb-8 flex items-center">
        <UserX class="w-8 h-8 mr-3 text-red-600" />
        Ex-Staff Management
    </h1>

    {#if message.text}
        <div class="p-4 mb-6 rounded-xl text-sm font-medium shadow-sm flex items-center
            {message.type === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-green-50 text-green-700 border border-green-200'}">
            {#if message.type === 'error'}<XCircle class="w-5 h-5 mr-2"/>{:else}<CheckCircle class="w-5 h-5 mr-2"/>{/if}
            {message.text}
        </div>
    {/if}

    <!-- Filters -->
    <div class="bg-white p-6 rounded-2xl shadow-lg mb-8">
        <div class="flex items-center mb-4 border-b pb-2">
            <Search class="w-5 h-5 mr-2 text-gray-700" />
            <h2 class="text-xl font-bold text-gray-800">Filter Ex-Employees</h2>
        </div>
        
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <!-- Search -->
            <input 
                type="text" 
                bind:value={filterName} 
                on:input={scheduleSearch}
                placeholder="Search Name or Employee Code..." 
                class="w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition"
            />
            
            <!-- Department -->
            <div class="flex items-center bg-white border border-gray-300 rounded-xl hover:border-indigo-400 transition">
                <UserCog class="w-5 h-5 text-gray-400 ml-3" />
                <select bind:value={filterDepartmentId} on:change={handleServerFilterChange} class="p-3 w-full bg-transparent border-none focus:ring-0 text-gray-700 cursor-pointer">
                    <option value="">All Departments</option>
                    {#each departments as dept}<option value={dept.$id}>{dept.name}</option>{/each}
                </select>
            </div>

            <!-- Position -->
            <div class="flex items-center bg-white border border-gray-300 rounded-xl hover:border-indigo-400 transition">
                <Briefcase class="w-5 h-5 text-gray-400 ml-3" />
                <select bind:value={filterPositionId} on:change={handleServerFilterChange} class="p-3 w-full bg-transparent border-none focus:ring-0 text-gray-700 cursor-pointer">
                    <option value="">All Positions</option>
                    {#if filterDepartmentId}
                        {#each positions.filter(p => p.departmentId === filterDepartmentId) as pos}<option value={pos.$id}>{pos.name}</option>{/each}
                    {:else}
                        {#each positions as pos}<option value={pos.$id}>{pos.name}</option>{/each}
                    {/if}
                </select>
            </div>
        </div>
    </div>

    <!-- Staff List -->
    <div class="bg-white p-6 rounded-2xl shadow-lg">
        <div class="flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
            <h2 class="text-xl font-bold text-gray-800 flex items-center">
                <UserX class="w-5 h-5 mr-2 text-gray-500" /> Relieved Staff List ({totalStaffRecords})
            </h2>
            <button on:click={loadExStaff} disabled={loading} class="p-2 text-gray-500 hover:text-blue-600 transition rounded-full hover:bg-blue-50" title="Refresh List">
                <RefreshCw class="w-5 h-5 {loading ? 'animate-spin' : ''}" />
            </button>
        </div>

        {#if loading && staffList.length === 0}
            <div class="text-center py-12 text-gray-500">Loading ex-staff data...</div>
        {:else if staffList.length === 0}
            <div class="text-center py-12 text-gray-500 bg-gray-50 rounded-xl">No ex-staff found matching your criteria.</div>
        {:else}
            <div class="overflow-x-auto rounded-xl border border-gray-200">
                <table class="min-w-full divide-y divide-gray-200">
                    <thead class="bg-gray-100">
                        <tr>
                            <th class="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">E. Code</th>
                            <th class="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Name</th>
                            <th class="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Department</th>
                            <th class="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Position</th>
                            <th class="px-6 py-3 text-center text-xs font-bold text-gray-500 uppercase tracking-wider">Action</th>
                        </tr>
                    </thead>
                    <tbody class="bg-white divide-y divide-gray-200">
                        {#each filteredStaff as staff (staff.$id)}
                            <tr class="hover:bg-green-50 transition group">
                                <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{staff.employeeCode}</td>
                                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-800">{staff.name}</td>
                                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{getDeptName(staff.departmentId)}</td>
                                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{getPositionName(staff.positionId)}</td>
                                
                                <td class="px-6 py-4 whitespace-nowrap text-center">
                                    <button 
                                        on:click={() => startActivate(staff)} 
                                        class="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded-lg shadow-sm text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 transition transform active:scale-95"
                                    >
                                        <UserCheck class="w-4 h-4 mr-1.5" /> Mark Active
                                    </button>
                                </td>
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
                        <button on:click={() => changePage(currentPage - 1)} disabled={currentPage === 1} class="px-3 py-1 rounded border hover:bg-gray-100 disabled:opacity-50 flex items-center"><ChevronLeft class="w-4 h-4 mr-1"/> Prev</button>
                        <button on:click={() => changePage(currentPage + 1)} disabled={currentPage === totalPages} class="px-3 py-1 rounded border hover:bg-gray-100 disabled:opacity-50 flex items-center">Next <ChevronRight class="w-4 h-4 ml-1"/></button>
                    </div>
                </div>
            {/if}
        {/if}
    </div>
</div>

<!-- Reactivate Confirmation Modal -->
{#if showActivateModal && staffToActivate}
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900 bg-opacity-75 backdrop-blur-sm">
        <div class="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 transform transition-all scale-100">
            <div class="flex items-center justify-center w-12 h-12 mx-auto bg-green-100 rounded-full mb-4">
                <UserCheck class="w-6 h-6 text-green-600" />
            </div>
            <h3 class="text-lg font-bold text-center text-gray-900 mb-2">Reactivate Staff Member?</h3>
            <p class="text-sm text-center text-gray-500 mb-6">
                Are you sure you want to change the status of <strong>{staffToActivate.name}</strong> (Code: {staffToActivate.employeeCode}) to <span class="font-bold text-green-600">Active</span>?
                <br/><br/>
                They will be moved back to the main staff list and removed from this Ex-Staff list.
            </p>
            <div class="flex space-x-3">
                <button on:click={cancelActivate} class="flex-1 px-4 py-2 bg-gray-100 text-gray-700 font-semibold rounded-xl hover:bg-gray-200 transition">Cancel</button>
                <button on:click={activateStaff} disabled={submitting} class="flex-1 px-4 py-2 bg-green-600 text-white font-semibold rounded-xl hover:bg-green-700 transition disabled:opacity-50">
                    {submitting ? 'Processing...' : 'Confirm & Activate'}
                </button>
            </div>
        </div>
    </div>
{/if}