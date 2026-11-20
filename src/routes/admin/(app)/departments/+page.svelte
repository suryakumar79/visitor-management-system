<script>
    import { onMount, onDestroy } from 'svelte';
    import { 
        databases, 
        realtime,
        ID, 
        VMS_DATABASE_ID, 
        DEPARTMENTS_COLLECTION_ID, 
        POSITIONS_COLLECTION_ID 
    } from '$lib/client';
    import { Eye, EyeOff, Edit, Trash2, Save, X, Plus, Filter } from 'lucide-svelte';
    
    // State Variables
    let departmentName = '';
    let positionName = '';
    let selectedDepartmentId = '';
    let departments = [];
    let positions = [];
    let filterDepartmentId = '';
    
    // OPTIMIZED: Lookup maps for O(1) access
    let departmentsMap = new Map();
    let positionsByDeptMap = new Map();
    
    // Editing State Variables
    let editingDeptId = null;
    let editingDeptName = '';
    let editingPositionId = null;
    let editingPositionName = '';
    
    // OPTIMIZED: Show hidden toggle
    let showHidden = false;
    
    let deptLoading = false;
    let positionLoading = false;
    let initialLoading = true;
    let message = { text: '', type: '' };

    let unsubscribeDept = () => {};
    let unsubscribePos = () => {};

    // Utility Functions

    function setMessage(text, type = 'error') {
        message = { text, type };
        setTimeout(() => message = { text: '', type: '' }, 5000);
    }

    // OPTIMIZED: Use Map for O(1) lookup
    function getPositionsByDepartment(departmentId) {
        return positionsByDeptMap.get(departmentId) || [];
    }
    
    // OPTIMIZED: Build lookup maps
    function buildLookupMaps() {
        // Department map
        departmentsMap = new Map(departments.map(d => [d.$id, d]));
        
        // Positions by department map
        positionsByDeptMap = new Map();
        positions.forEach(pos => {
            if (!positionsByDeptMap.has(pos.departmentId)) {
                positionsByDeptMap.set(pos.departmentId, []);
            }
            positionsByDeptMap.get(pos.departmentId).push(pos);
        });
    }
    
    // Data Fetching

    async function loadDepartmentsAndPositions() {
        if (initialLoading) {
            deptLoading = true;
        }
        message = { text: '', type: '' };
        
        try {
            // OPTIMIZED: Parallel fetch for better performance
            const [deptResponse, posResponse] = await Promise.all([
                databases.listDocuments(
                    VMS_DATABASE_ID,
                    DEPARTMENTS_COLLECTION_ID,
                    [],
                    500 // Increased limit
                ),
                databases.listDocuments(
                    VMS_DATABASE_ID,
                    POSITIONS_COLLECTION_ID,
                    [],
                    1000 // Increased limit
                )
            ]);

            departments = deptResponse.documents;
            positions = posResponse.documents;

            // OPTIMIZED: Build lookup maps
            buildLookupMaps();

            console.log('Loaded:', departments.length, 'departments,', positions.length, 'positions');

        } catch (error) {
            console.error('Failed to load data:', error);
            setMessage('Failed to load departments or positions. Please check your connection.', 'error');
        } finally {
            deptLoading = false;
            initialLoading = false;
        }
    }

    onMount(() => {
        loadDepartmentsAndPositions();

        // Setup realtime listeners
        unsubscribeDept = realtime.subscribe(
            `databases.${VMS_DATABASE_ID}.collections.${DEPARTMENTS_COLLECTION_ID}.documents`,
            (response) => {
                console.log('Realtime update - Departments:', response);
                loadDepartmentsAndPositions();
            }
        );
        
        unsubscribePos = realtime.subscribe(
            `databases.${VMS_DATABASE_ID}.collections.${POSITIONS_COLLECTION_ID}.documents`,
            (response) => {
                console.log('Realtime update - Positions:', response);
                loadDepartmentsAndPositions();
            }
        );
    });
    
    onDestroy(() => {
        if (typeof unsubscribeDept === "function") unsubscribeDept();
        if (typeof unsubscribePos === "function") unsubscribePos();
    });

    // Department Handlers

    async function createDepartment() {
        const name = departmentName.trim();
        if (!name) {
            setMessage('Department name cannot be empty.', 'error');
            return;
        }

        // OPTIMIZED: Case-insensitive check
        const lowerName = name.toLowerCase();
        const exists = departments.some(d => d.name.toLowerCase() === lowerName);
        
        if (exists) {
            setMessage(`A department named "${name}" already exists.`, 'error');
            return;
        }

        deptLoading = true;
        message = { text: '', type: '' };

        try {
            await databases.createDocument(
                VMS_DATABASE_ID,
                DEPARTMENTS_COLLECTION_ID,
                ID.unique(),
                { 
                    name: name,
                    status: 'active' // NEW: Default to active
                }
            );
            departmentName = '';
            setMessage(`Department "${name}" created successfully!`, 'success');
        } catch (error) {
            console.error('Department creation failed:', error);
            setMessage('Failed to create department. Please try again.', 'error');
        } finally {
            deptLoading = false;
        }
    }

    async function deleteDepartment(id) {
        if (!window.confirm('Are you sure you want to delete this department? This cannot be undone.')) {
            return;
        }
        try {
            await databases.deleteDocument(
                VMS_DATABASE_ID,
                DEPARTMENTS_COLLECTION_ID,
                id
            );
            setMessage('Department deleted successfully.', 'success');
        } catch (error) {
            console.error('Department deletion failed:', error);
            setMessage('Failed to delete department.', 'error');
        }
    }
    
    // NEW: Toggle department visibility
    async function toggleDepartmentStatus(dept) {
        const newStatus = dept.status === 'active' ? 'hidden' : 'active';
        
        try {
            await databases.updateDocument(
                VMS_DATABASE_ID,
                DEPARTMENTS_COLLECTION_ID,
                dept.$id,
                { status: newStatus }
            );
            setMessage(`Department "${dept.name}" ${newStatus === 'hidden' ? 'hidden' : 'shown'} successfully!`, 'success');
        } catch (error) {
            console.error('Failed to toggle department status:', error);
            setMessage('Failed to update department status.', 'error');
        }
    }
    
    // Department Edit Handlers
    function startEditDepartment(dept) {
        editingPositionId = null;
        editingDeptId = dept.$id;
        editingDeptName = dept.name;
    }

    function cancelEditDepartment() {
        editingDeptId = null;
        editingDeptName = '';
        message = { text: '', type: '' };
    }

    async function updateDepartment() {
        const newName = editingDeptName.trim();
        if (!newName) {
            setMessage('Department name cannot be empty.', 'error');
            return;
        }

        const lowerName = newName.toLowerCase();
        const exists = departments.some(
            d => d.name.toLowerCase() === lowerName && d.$id !== editingDeptId
        );
        
        if (exists) {
            setMessage(`A department named "${newName}" already exists.`, 'error');
            return;
        }

        deptLoading = true;
        message = { text: '', type: '' };

        try {
            await databases.updateDocument(
                VMS_DATABASE_ID,
                DEPARTMENTS_COLLECTION_ID,
                editingDeptId,
                { name: newName }
            );
            setMessage(`Department updated to "${newName}" successfully!`, 'success');
            cancelEditDepartment();
        } catch (error) {
            console.error('Department update failed:', error);
            setMessage('Failed to update department.', 'error');
        } finally {
            deptLoading = false;
        }
    }

    // Position Handlers

    async function createPosition() {
        const name = positionName.trim();
        if (!name || !selectedDepartmentId) {
            setMessage('Both position name and department must be selected.', 'error');
            return;
        }

        const departmentPositions = getPositionsByDepartment(selectedDepartmentId);
        const lowerName = name.toLowerCase();
        const exists = departmentPositions.some(p => p.name.toLowerCase() === lowerName);
        
        if (exists) {
            const dept = departmentsMap.get(selectedDepartmentId);
            const deptName = dept?.name || 'the selected department';
            setMessage(`A position named "${name}" already exists under ${deptName}.`, 'error');
            return;
        }

        positionLoading = true;
        message = { text: '', type: '' };

        try {
            await databases.createDocument(
                VMS_DATABASE_ID,
                POSITIONS_COLLECTION_ID,
                ID.unique(),
                { 
                    name: name,
                    departmentId: selectedDepartmentId,
                    status: 'active' // NEW: Default to active
                }
            );
            positionName = '';
            setMessage(`Position "${name}" created successfully!`, 'success');
        } catch (error) {
            console.error('Position creation failed:', error);
            setMessage('Failed to create position.', 'error');
        } finally {
            positionLoading = false;
        }
    }

    async function deletePosition(id) {
        if (!window.confirm('Are you sure you want to delete this position?')) {
            return;
        }
        try {
            await databases.deleteDocument(
                VMS_DATABASE_ID,
                POSITIONS_COLLECTION_ID,
                id
            );
            setMessage('Position deleted successfully.', 'success');
        } catch (error) {
            console.error('Position deletion failed:', error);
            setMessage('Failed to delete position.', 'error');
        }
    }

    // NEW: Toggle position visibility
    async function togglePositionStatus(pos) {
        const newStatus = pos.status === 'active' ? 'hidden' : 'active';
        
        try {
            await databases.updateDocument(
                VMS_DATABASE_ID,
                POSITIONS_COLLECTION_ID,
                pos.$id,
                { status: newStatus }
            );
            setMessage(`Position "${pos.name}" ${newStatus === 'hidden' ? 'hidden' : 'shown'} successfully!`, 'success');
        } catch (error) {
            console.error('Failed to toggle position status:', error);
            setMessage('Failed to update position status.', 'error');
        }
    }

    // Position Edit Handlers
    function startEditPosition(pos) {
        editingDeptId = null;
        editingPositionId = pos.$id;
        editingPositionName = pos.name;
    }

    function cancelEditPosition() {
        editingPositionId = null;
        editingPositionName = '';
        message = { text: '', type: '' };
    }

    async function updatePosition() {
        const newName = editingPositionName.trim();
        if (!newName) {
            setMessage('Position name cannot be empty.', 'error');
            return;
        }
        
        const currentPosition = positions.find(p => p.$id === editingPositionId);
        if (!currentPosition) return;

        const departmentPositions = getPositionsByDepartment(currentPosition.departmentId);
        const lowerName = newName.toLowerCase();
        const exists = departmentPositions.some(
            p => p.name.toLowerCase() === lowerName && p.$id !== editingPositionId
        );
        
        if (exists) {
            const dept = departmentsMap.get(currentPosition.departmentId);
            const deptName = dept?.name || 'the selected department';
            setMessage(`A position named "${newName}" already exists under ${deptName}.`, 'error');
            return;
        }

        positionLoading = true;
        message = { text: '', type: '' };

        try {
            await databases.updateDocument(
                VMS_DATABASE_ID,
                POSITIONS_COLLECTION_ID,
                editingPositionId,
                { name: newName }
            );
            setMessage(`Position updated to "${newName}" successfully!`, 'success');
            cancelEditPosition();
        } catch (error) {
            console.error('Position update failed:', error);
            setMessage('Failed to update position.', 'error');
        } finally {
            positionLoading = false;
        }
    }

    // OPTIMIZED: Reactive filtering with status toggle
    $: visibleDepartments = (() => {
        let filtered = departments;
        
        // Filter by hidden status
        if (!showHidden) {
            filtered = filtered.filter(d => d.status !== 'hidden');
        }
        
        // Filter by selected department
        if (filterDepartmentId) {
            filtered = filtered.filter(d => d.$id === filterDepartmentId);
        }
        
        return filtered;
    })();

    $: totalPositions = positions.length;
    $: activePositions = positions.filter(p => p.status !== 'hidden').length;
    $: hiddenPositions = positions.filter(p => p.status === 'hidden').length;
    $: activeDepartments = departments.filter(d => d.status !== 'hidden').length;
    $: hiddenDepartments = departments.filter(d => d.status === 'hidden').length;
</script>

<div class="p-4 bg-gray-50 min-h-screen">
    <div class="mb-8">
        <h1 class="text-3xl font-bold text-gray-800 mb-2">🏢 Department & Position Management</h1>
        <div class="flex gap-4 text-sm text-gray-600">
            <span>Departments: <strong class="text-green-600">{activeDepartments} active</strong> {#if hiddenDepartments > 0}/ <strong class="text-orange-600">{hiddenDepartments} hidden</strong>{/if}</span>
            <span>•</span>
            <span>Positions: <strong class="text-green-600">{activePositions} active</strong> {#if hiddenPositions > 0}/ <strong class="text-orange-600">{hiddenPositions} hidden</strong>{/if}</span>
        </div>
    </div>

    <!-- Global Messages -->
    {#if message.text}
        <div class="p-3 mb-4 rounded-lg text-sm font-medium transition-opacity duration-300
            {message.type === 'error' ? 'bg-red-100 text-red-700 border border-red-400' : 'bg-green-100 text-green-700 border border-green-400'}"
            role="alert">
            {message.text}
        </div>
    {/if}

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-10">
        <!-- Create Department Form -->
        <div class="bg-white p-6 rounded-xl shadow-lg border-t-4 border-indigo-500">
            <h2 class="text-2xl font-semibold text-gray-700 mb-4 flex items-center">
                <Plus class="w-6 h-6 mr-2 text-indigo-600" />
                Create New Department
            </h2>
            <form on:submit|preventDefault={createDepartment} class="space-y-4">
                <input
                    type="text"
                    bind:value={departmentName}
                    placeholder="e.g., Sales, HR, Engineering"
                    class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
                    disabled={deptLoading}
                />
                <button
                    type="submit"
                    class="w-full py-3 px-4 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 transition duration-150 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                    disabled={deptLoading}
                >
                    {#if deptLoading}
                        <span class="animate-spin mr-2">⏳</span>
                        Creating...
                    {:else}
                        <Plus class="w-5 h-5 mr-2" />
                        Add Department
                    {/if}
                </button>
            </form>
        </div>

        <!-- Create Position Form -->
        <div class="bg-white p-6 rounded-xl shadow-lg border-t-4 border-green-500">
            <h2 class="text-2xl font-semibold text-gray-700 mb-4 flex items-center">
                <Plus class="w-6 h-6 mr-2 text-green-600" />
                Create New Position
            </h2>
            <form on:submit|preventDefault={createPosition} class="space-y-4">
                <select
                    bind:value={selectedDepartmentId}
                    class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 bg-white transition"
                    disabled={positionLoading || departments.length === 0}
                >
                    <option value="" disabled selected>--- Select Department ---</option>
                    {#each departments.filter(d => d.status !== 'hidden') as dept (dept.$id)}
                        <option value={dept.$id}>{dept.name}</option>
                    {/each}
                </select>
                
                <input
                    type="text"
                    bind:value={positionName}
                    placeholder="e.g., Software Engineer, HR Specialist"
                    class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 transition"
                    disabled={positionLoading}
                />

                <button
                    type="submit"
                    class="w-full py-3 px-4 bg-green-600 text-white font-medium rounded-lg hover:bg-green-700 transition duration-150 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                    disabled={positionLoading}
                >
                    {#if positionLoading}
                        <span class="animate-spin mr-2">⏳</span>
                        Creating...
                    {:else}
                        <Plus class="w-5 h-5 mr-2" />
                        Add Position
                    {/if}
                </button>
            </form>
        </div>
    </div>

    <!-- List Departments and Positions -->
    <div class="bg-white p-6 rounded-xl shadow-lg">
        <div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
            <h2 class="text-2xl font-semibold text-gray-700">Department Structure</h2>
            
            <div class="flex gap-3">
                <!-- Show Hidden Toggle -->
                <button
                    on:click={() => showHidden = !showHidden}
                    class="flex items-center gap-2 px-4 py-2 rounded-lg border transition {showHidden ? 'bg-orange-50 border-orange-300 text-orange-700' : 'bg-gray-50 border-gray-300 text-gray-700 hover:bg-gray-100'}"
                >
                    {#if showHidden}
                        <Eye class="w-4 h-4" />
                        Showing Hidden
                    {:else}
                        <EyeOff class="w-4 h-4" />
                        Hide Hidden
                    {/if}
                </button>
            </div>
        </div>
        
        <!-- Filter Option -->
        <div class="mb-6 max-w-sm">
             <label for="dept-filter" class="block text-sm font-medium text-gray-700 mb-2 flex items-center">
                <Filter class="w-4 h-4 mr-2" />
                Filter by Department
            </label>
             <select
                id="dept-filter"
                bind:value={filterDepartmentId}
                class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white transition"
            >
                <option value="">Show All Departments</option>
                {#each departments.filter(d => showHidden || d.status !== 'hidden') as dept (dept.$id)}
                    <option value={dept.$id}>
                        {dept.name} {dept.status === 'hidden' ? '(Hidden)' : ''}
                    </option>
                {/each}
            </select>
        </div>

        {#if initialLoading}
            <p class="text-center text-gray-500 py-12">Loading department structure...</p>
        {:else if departments.length === 0}
            <p class="text-center text-gray-500 py-12">No departments found. Start by creating one!</p>
        {:else if visibleDepartments.length === 0}
            <p class="text-center text-gray-500 py-12">No departments match the current filter.</p>
        {:else}
            <div class="space-y-6">
                {#each visibleDepartments as dept (dept.$id)}
                    <div class="border border-gray-200 rounded-lg p-5 bg-gray-50 hover:shadow-md transition duration-150 {dept.status === 'hidden' ? 'opacity-60 bg-orange-50 border-orange-200' : ''}">
                        <!-- Department Header -->
                        {#if editingDeptId === dept.$id}
                            <div class="flex items-center space-x-2 mb-3">
                                <input
                                    type="text"
                                    bind:value={editingDeptName}
                                    class="text-xl font-bold w-full p-2 border rounded-lg"
                                    on:keydown={(e) => { if (e.key === 'Enter') updateDepartment(); }}
                                />
                                <button on:click={updateDepartment} class="bg-indigo-500 text-white px-3 py-2 rounded-lg hover:bg-indigo-600 text-sm flex items-center">
                                    <Save class="w-4 h-4 mr-1" /> Save
                                </button>
                                <button on:click={cancelEditDepartment} class="bg-gray-300 text-gray-800 px-3 py-2 rounded-lg hover:bg-gray-400 text-sm flex items-center">
                                    <X class="w-4 h-4 mr-1" /> Cancel
                                </button>
                            </div>
                        {:else}
                            <div class="flex flex-wrap justify-between items-center gap-2 mb-3">
                                <div class="flex items-center gap-2">
                                    <h3 class="text-xl font-bold text-indigo-700">{dept.name}</h3>
                                    {#if dept.status === 'hidden'}
                                        <span class="px-2 py-1 bg-orange-100 text-orange-700 text-xs font-semibold rounded-full">Hidden</span>
                                    {/if}
                                </div>
                                <div class="flex flex-wrap gap-2">
                                    <button 
                                        on:click={() => toggleDepartmentStatus(dept)} 
                                        class="text-gray-600 hover:text-gray-800 text-sm font-medium transition duration-150 px-2 py-1 rounded-md hover:bg-gray-200 flex items-center"
                                        title={dept.status === 'hidden' ? 'Show Department' : 'Hide Department'}
                                    >
                                        {#if dept.status === 'hidden'}
                                            <Eye class="w-4 h-4 mr-1" /> Show
                                        {:else}
                                            <EyeOff class="w-4 h-4 mr-1" /> Hide
                                        {/if}
                                    </button>
                                    <button on:click={() => startEditDepartment(dept)} class="text-blue-500 hover:text-blue-700 text-sm font-medium transition duration-150 px-2 py-1 rounded-md hover:bg-blue-50 flex items-center">
                                        <Edit class="w-4 h-4 mr-1" /> Edit
                                    </button>
                                    <button on:click={() => deleteDepartment(dept.$id)} class="text-red-500 hover:text-red-700 text-sm font-medium transition duration-150 px-2 py-1 rounded-md hover:bg-red-50 flex items-center">
                                        <Trash2 class="w-4 h-4 mr-1" /> Delete
                                    </button>
                                </div>
                            </div>
                        {/if}

                        <!-- Positions List -->
                        <div class="space-y-2 border-l-4 border-gray-300 pl-4 mt-4">
                            <p class="text-sm font-semibold text-gray-600 mb-2">Positions:</p>
                            {#each getPositionsByDepartment(dept.$id).filter(p => showHidden || p.status !== 'hidden') as pos (pos.$id)}
                                <div class="flex flex-wrap justify-between items-center gap-2 bg-white p-3 rounded-md border border-gray-200 hover:border-gray-300 transition {pos.status === 'hidden' ? 'opacity-60 bg-orange-50' : ''}">
                                    
                                    {#if editingPositionId === pos.$id}
                                        <div class="flex items-center w-full space-x-2">
                                            <input
                                                type="text"
                                                bind:value={editingPositionName}
                                                class="w-full p-2 border rounded-lg text-sm"
                                                on:keydown={(e) => { if (e.key === 'Enter') updatePosition(); }}
                                            />
                                            <button on:click={updatePosition} class="bg-green-500 text-white px-2 py-1 rounded-lg hover:bg-green-600 text-xs flex items-center">
                                                <Save class="w-3 h-3 mr-1" /> Save
                                            </button>
                                            <button on:click={cancelEditPosition} class="bg-gray-300 text-gray-800 px-2 py-1 rounded-lg hover:bg-gray-400 text-xs flex items-center">
                                                <X class="w-3 h-3 mr-1" /> Cancel
                                            </button>
                                        </div>
                                    {:else}
                                        <div class="flex items-center gap-2">
                                            <p class="text-gray-800">{pos.name}</p>
                                            {#if pos.status === 'hidden'}
                                                <span class="px-2 py-0.5 bg-orange-100 text-orange-600 text-xs font-semibold rounded-full">Hidden</span>
                                            {/if}
                                        </div>
                                        <div class="flex flex-wrap gap-2">
                                            <button 
                                                on:click={() => togglePositionStatus(pos)} 
                                                class="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded-md hover:bg-gray-100 flex items-center"
                                                title={pos.status === 'hidden' ? 'Show Position' : 'Hide Position'}
                                            >
                                                {#if pos.status === 'hidden'}
                                                    <Eye class="w-3 h-3 mr-1" /> Show
                                                {:else}
                                                    <EyeOff class="w-3 h-3 mr-1" /> Hide
                                                {/if}
                                            </button>
                                            <button on:click={() => startEditPosition(pos)} class="text-xs text-blue-400 hover:text-blue-600 px-2 py-1 rounded-md hover:bg-blue-50 flex items-center">
                                                <Edit class="w-3 h-3 mr-1" /> Edit
                                            </button>
                                            <button on:click={() => deletePosition(pos.$id)} class="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded-md hover:bg-red-50 flex items-center">
                                                <Trash2 class="w-3 h-3 mr-1" /> Delete
                                            </button>
                                        </div>
                                    {/if}
                                </div>
                            {:else}
                                <p class="text-sm text-gray-400 italic">No {showHidden ? '' : 'visible '}positions currently linked to this department.</p>
                            {/each}
                        </div>
                    </div>
                {/each}
            </div>
        {/if}
    </div>
</div>