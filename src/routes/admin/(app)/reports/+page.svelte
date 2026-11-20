<script>
    import { onMount } from 'svelte';
    import { 
        databases, 
        storage,
        Query,
        VMS_DATABASE_ID,
        VISITOR_LOGS_COLLECTION_ID,
        DEPARTMENTS_COLLECTION_ID,
        POSITIONS_COLLECTION_ID,
        STAFF_COLLECTION_ID,
        VISITOR_SELFIES_BUCKET_ID
    } from '$lib/client';
    import { Download, X } from 'lucide-svelte';

    // Get today's date for default filter
    const today = new Date().toISOString().split('T')[0];

    // Filters with date range
    let filters = {
        staffName: '',
        position: '',
        department: '',
        visitorName: '',
        company: '',
        searchTerm: '',
        fromDate: today,
        toDate: today
    };

    // Dropdown data
    let staffList = [];
    let positionsList = [];
    let departmentsList = [];
    let companiesList = [];

    // OPTIMIZED: Lookup maps for O(1) access
    let departmentsMap = new Map();
    let positionsMap = new Map();

    // Visitor logs
    let visitorLogs = [];
    let filteredLogs = [];

    // Pagination
    const pageSize = 50;
    let currentPage = 1;
    let paginatedLogs = [];

    // Reactive filtered positions
    let filteredPositionsList = [];

    // Modal
    let showModal = false;
    let selectedVisitor = null;

    // Loading
    let loading = true;

    // OPTIMIZED: Debounce timer
    let filterTimeout;

    // OPTIMIZED: Cache
    const CACHE_KEY = 'vms_dropdown_cache';
    const CACHE_DURATION = 5 * 60 * 1000;

    // OPTIMIZED: Selfie URL cache
    const selfieUrlCache = new Map();

    function getCachedData() {
        try {
            const cached = localStorage.getItem(CACHE_KEY);
            if (cached) {
                const { data, timestamp } = JSON.parse(cached);
                if (Date.now() - timestamp < CACHE_DURATION) {
                    return data;
                }
            }
        } catch (e) {
            console.error('Cache read error:', e);
        }
        return null;
    }

    function setCachedData(data) {
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify({
                data,
                timestamp: Date.now()
            }));
        } catch (e) {
            console.error('Cache write error:', e);
        }
    }

    onMount(async () => {
        await fetchDropdownData();
        await fetchVisitorLogs();
        loading = false;
        
        // Cleanup
        return () => {
            if (filterTimeout) clearTimeout(filterTimeout);
        };
    });

    // OPTIMIZED: Reactive department/position filtering
    $: {
        if (filters.department) {
            filteredPositionsList = positionsList.filter(p => p.departmentId === filters.department);
            if (filters.position && !filteredPositionsList.find(p => p.$id === filters.position)) {
                filters.position = '';
            }
        } else {
            filteredPositionsList = positionsList;
        }
    }

    // OPTIMIZED: Debounced filtering for text inputs
    $: if (filters.visitorName || filters.searchTerm) {
        scheduleFilterUpdate();
    } else {
        applyFilters(filters, visitorLogs);
    }

    // OPTIMIZED: Separate reactive for non-text filters
    $: if (filters.staffName || filters.position || filters.department || filters.company) {
        applyFilters(filters, visitorLogs);
    }

    // OPTIMIZED: Efficient pagination
    $: {
        const start = (currentPage - 1) * pageSize;
        const end = start + pageSize;
        paginatedLogs = filteredLogs.slice(start, end);
    }

    function scheduleFilterUpdate() {
        clearTimeout(filterTimeout);
        filterTimeout = setTimeout(() => {
            applyFilters(filters, visitorLogs);
        }, 200);
    }

    async function fetchDropdownData() {
        const cached = getCachedData();
        if (cached) {
            departmentsList = cached.departments;
            positionsList = cached.positions;
            staffList = cached.staff;
            companiesList = cached.companies;
            
            // OPTIMIZED: Build lookup maps
            departmentsMap = new Map(departmentsList.map(d => [d.$id, d.name]));
            positionsMap = new Map(positionsList.map(p => [p.$id, p.name]));
            
            return;
        }

        try {
            // OPTIMIZED: Parallel fetching
            const [depts, positions, staff, logs] = await Promise.all([
                databases.listDocuments(VMS_DATABASE_ID, DEPARTMENTS_COLLECTION_ID, [
                    Query.orderAsc('name'),
                    Query.limit(1000)
                ]),
                databases.listDocuments(VMS_DATABASE_ID, POSITIONS_COLLECTION_ID, [
                    Query.orderAsc('name'),
                    Query.limit(1000)
                ]),
                databases.listDocuments(VMS_DATABASE_ID, STAFF_COLLECTION_ID, [
                    Query.orderAsc('name'),
                    Query.limit(1000)
                ]),
                databases.listDocuments(VMS_DATABASE_ID, VISITOR_LOGS_COLLECTION_ID, [
                    Query.limit(1000),
                    Query.select(['companyName'])
                ])
            ]);

            departmentsList = depts.documents;
            positionsList = positions.documents;
            staffList = staff.documents;

            // OPTIMIZED: Build lookup maps
            departmentsMap = new Map(departmentsList.map(d => [d.$id, d.name]));
            positionsMap = new Map(positionsList.map(p => [p.$id, p.name]));

            // OPTIMIZED: Extract unique companies using Set
            const companiesSet = new Set(logs.documents.map(log => log.companyName).filter(Boolean));
            companiesList = Array.from(companiesSet).sort();

            setCachedData({
                departments: departmentsList,
                positions: positionsList,
                staff: staffList,
                companies: companiesList
            });

        } catch (error) {
            console.error('Error fetching dropdown data:', error);
        }
    }

    function getLastStatusDate(log) {
        return log.checkoutTime || log.checkinTime || log.approvalTime || log.requestTime;
    }

    async function fetchVisitorLogs() {
        loading = true;
        try {
            const fromISO = filters.fromDate ? new Date(filters.fromDate + 'T00:00:00+05:30').toISOString() : null;
            const toISO = filters.toDate ? new Date(filters.toDate + 'T23:59:59.999+05:30').toISOString() : null;

            // 30-day buffer before fromDate to catch pre-approved passes
            const windowStart = fromISO ? new Date(fromISO) : null;
            if (windowStart) windowStart.setDate(windowStart.getDate() - 30);

            const queries = [
                Query.orderDesc('$updatedAt'),
                Query.limit(5000)
            ];

            if (windowStart) queries.push(Query.greaterThanEqual('$updatedAt', windowStart.toISOString()));
            if (toISO) queries.push(Query.lessThanEqual('$updatedAt', toISO));

            const result = await databases.listDocuments(
                VMS_DATABASE_ID,
                VISITOR_LOGS_COLLECTION_ID,
                queries
            );

            const allLogs = result.documents.map(log => ({
                ...log,
                departmentName: departmentsMap.get(log.departmentId) || 'Unknown',
                positionName: positionsMap.get(log.positionId) || 'Unknown',
                lastStatusDate: getLastStatusDate(log)
            }));

            // Filter client-side by lastStatusDate within exact selected range
            visitorLogs = allLogs.filter(log => {
                const lastDate = log.lastStatusDate;
                if (!lastDate) return false;
                if (fromISO && lastDate < fromISO) return false;
                if (toISO && lastDate > toISO) return false;
                return true;
            });

            filteredLogs = visitorLogs;
            currentPage = 1;
        } catch (error) {
            console.error('Error fetching visitor logs:', error);
        } finally {
            loading = false;
        }
    }

    // OPTIMIZED: Efficient filtering with early returns
    function applyFilters(currentFilters, logs) {
        // Early return if no filters
        if (!currentFilters.staffName && 
            !currentFilters.position && 
            !currentFilters.department && 
            !currentFilters.visitorName && 
            !currentFilters.company && 
            !currentFilters.searchTerm) {
            filteredLogs = logs;
            currentPage = 1;
            return;
        }

        // Pre-lowercase search terms
        const lowerVisitorName = currentFilters.visitorName.toLowerCase();
        const lowerSearchTerm = currentFilters.searchTerm.toLowerCase();

        const filtered = logs.filter(log => {
            // Early returns on failed conditions
            if (currentFilters.staffName && log.staffId !== currentFilters.staffName) return false;
            if (currentFilters.position && log.positionId !== currentFilters.position) return false;
            if (currentFilters.department && log.departmentId !== currentFilters.department) return false;
            if (currentFilters.company && log.companyName !== currentFilters.company) return false;
            
            if (currentFilters.visitorName && 
                !log.visitorName.toLowerCase().includes(lowerVisitorName)) {
                return false;
            }
            
            if (currentFilters.searchTerm) {
                const emailMatch = log.visitorEmail?.toLowerCase().includes(lowerSearchTerm);
                const phoneMatch = log.visitorPhone?.includes(currentFilters.searchTerm);
                const staffEmailMatch = log.staffEmail?.toLowerCase().includes(lowerSearchTerm);
                const staffPhoneMatch = log.staffPhone?.includes(currentFilters.searchTerm);
                
                if (!emailMatch && !phoneMatch && !staffEmailMatch && !staffPhoneMatch) {
                    return false;
                }
            }
            
            return true;
        });

        filteredLogs = filtered;
        currentPage = 1;
    }

    function clearFilters() {
        filters = {
            staffName: '',
            position: '',
            department: '',
            visitorName: '',
            company: '',
            searchTerm: '',
            fromDate: '',
            toDate: ''
        };
    }

    // OPTIMIZED: More efficient CSV generation
    function downloadExcel() {
        const headers = [
            'Visitor Name', 'Email', 'Phone', 'Company',
            'Staff Name', 'Staff Email', 'Staff Phone',
            'Department', 'Position', 'Purpose', 'Status',
            'Pass Date',  // ✅ Added
            'Total Members', 'Members Checked Out', 'Members Inside',
            'Products', 'Request Time', 'Approval Time',
            'Check-in Time', 'Checkout Time', 'Notes',
            'Rejection Reason', 'Status Changed By'
        ];

        const rows = new Array(filteredLogs.length);
        
        for (let i = 0; i < filteredLogs.length; i++) {
            const log = filteredLogs[i];
            const totalMembers = log.totalMembers || 1;
            const membersOut = parseInt(log.totalMembersOut) || 0;

            rows[i] = [
                log.visitorName,
                log.visitorEmail,
                // ✅ Fix: prefix with tab character to force Excel to treat as text
                `\t${log.visitorPhone || ''}`,
                log.companyName,
                log.staffName,
                log.staffEmail,
                // ✅ Fix: same for staff phone
                `\t${log.staffPhone || ''}`,
                log.departmentName,
                log.positionName,
                log.purpose,
                log.status,
                log.passDate || '-',  // ✅ Added
                totalMembers,
                membersOut,
                totalMembers - membersOut,
                log.productsDesc || '',
                formatDateTime(log.requestTime),
                formatDateTime(log.approvalTime),
                formatDateTime(log.checkinTime),
                formatDateTime(log.checkoutTime),
                log.notes || '',
                log.rejectionReason || '',
                log.statusChangedBy || ''
            ].map(cell => `"${String(cell).replace(/"/g, '""')}"`);
        }

        const csvContent = [
            headers.join(','),
            ...rows.map(row => row.join(','))
        ].join('\n');

        const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' }); // ✅ BOM for Excel UTF-8
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `visitor-logs-${filters.fromDate || 'all'}-to-${filters.toDate || 'all'}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);
    }

    function getStatusBadge(status) {
        const styles = {
            pending: 'bg-yellow-100 text-yellow-800',
            approved: 'bg-green-100 text-green-800',
            rejected: 'bg-red-100 text-red-800',
            'checked-in': 'bg-blue-100 text-blue-800',
            'checked-out': 'bg-gray-100 text-gray-800',
            'partial-checkout': 'bg-orange-100 text-orange-800'
        };
        return styles[status] || 'bg-gray-100 text-gray-800';
    }

    // OPTIMIZED: Cached date formatting
    const dateFormatCache = new Map();
    
    function formatDateTime(dateString) {
        if (!dateString) return '-';
        
        if (dateFormatCache.has(dateString)) {
            return dateFormatCache.get(dateString);
        }
        
        const formatted = new Date(dateString).toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
        
        dateFormatCache.set(dateString, formatted);
        return formatted;
    }

    // OPTIMIZED: Cached selfie URLs
    function getSelfieUrl(fileId) {
        if (!fileId) return null;
        
        if (selfieUrlCache.has(fileId)) {
            return selfieUrlCache.get(fileId);
        }
        
        try {
            const url = storage.getFileView(VISITOR_SELFIES_BUCKET_ID, fileId).toString();
            selfieUrlCache.set(fileId, url);
            return url;
        } catch (error) {
            console.error('Failed to load selfie:', error);
            return null;
        }
    }

    function calculateMembersInside(log) {
        const totalMembers = log.totalMembers || 1;
        const membersOut = parseInt(log.totalMembersOut) || 0;
        return totalMembers - membersOut;
    }
</script>

<svelte:head>
    <title>Reports - VMS</title>
</svelte:head>

<div class="p-6 bg-gray-50 min-h-screen">
    <!-- Header -->
    <div class="mb-6">
        <h1 class="text-3xl font-bold text-gray-800">Visitor Reports</h1>
        <p class="text-gray-600 mt-1">Generate and download visitor reports with custom filters</p>
    </div>

    {#if loading}
        <div class="flex justify-center items-center h-64">
            <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
    {:else}
        <!-- Filters Section -->
        <div class="bg-white rounded-lg shadow p-6 mb-6">
            <div class="flex items-center justify-between mb-4">
                <h2 class="text-xl font-semibold text-gray-800">Filters</h2>
                <button
                    on:click={clearFilters}
                    class="text-sm text-blue-600 hover:text-blue-800 font-medium"
                >
                    Clear All Filters
                </button>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
                <!-- Staff Name -->
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">Staff Name</label>
                    <select
                        bind:value={filters.staffName}
                        class="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                        <option value="">All Staff</option>
                        {#each staffList as staff}
                            <option value={staff.$id}>{staff.name}</option>
                        {/each}
                    </select>
                </div>

                <!-- Department -->
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">Department</label>
                    <select
                        bind:value={filters.department}
                        class="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                        <option value="">All Departments</option>
                        {#each departmentsList as dept}
                            <option value={dept.$id}>{dept.name}</option>
                        {/each}
                    </select>
                </div>

                <!-- Position -->
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">Position</label>
                    <select
                        bind:value={filters.position}
                        class="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                        <option value="">All Positions</option>
                        {#each filteredPositionsList as position}
                            <option value={position.$id}>{position.name}</option>
                        {/each}
                    </select>
                </div>

                <!-- Company -->
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">Company</label>
                    <select
                        bind:value={filters.company}
                        class="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                        <option value="">All Companies</option>
                        {#each companiesList as company}
                            <option value={company}>{company}</option>
                        {/each}
                    </select>
                </div>

                <!-- Visitor Name -->
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">Visitor Name</label>
                    <input
                        type="text"
                        bind:value={filters.visitorName}
                        placeholder="Search visitor..."
                        class="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                </div>

                <!-- Email/Phone Search -->
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">Email/Phone</label>
                    <input
                        type="text"
                        bind:value={filters.searchTerm}
                        placeholder="Search email or phone..."
                        class="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                </div>

                <!-- From Date -->
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">From Date</label>
                    <input
                        type="date"
                        bind:value={filters.fromDate}
                        class="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                </div>

                <!-- To Date -->
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">To Date</label>
                    <input
                        type="date"
                        bind:value={filters.toDate}
                        class="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                </div>
            </div>
        </div>

        <!-- Apply Filters Button -->
        <div class="mb-4">
            <button
                on:click={fetchVisitorLogs}
                class="w-full px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium disabled:bg-gray-400 disabled:cursor-not-allowed"
                disabled={loading}
            >
                {loading ? 'Loading...' : 'Apply Filters & Load Visitor Logs'}
            </button>
        </div>

        <!-- Action Bar -->
        <div class="flex items-center justify-between mb-4">
            <p class="text-sm text-gray-600">
                Showing <span class="font-semibold">{paginatedLogs.length}</span> of 
                <span class="font-semibold">{filteredLogs.length}</span> visitor logs
            </p>
            <button
                on:click={downloadExcel}
                class="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition"
                disabled={filteredLogs.length === 0}
            >
                <Download class="w-4 h-4" />
                Download Excel ({filteredLogs.length} records)
            </button>
        </div>

        <!-- Visitor Logs Table -->
        <div class="bg-white rounded-lg shadow overflow-hidden">
            <div class="overflow-x-auto">
                <table class="w-full">
                    <thead class="bg-gray-50 border-b">
                        <tr>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Photo</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Visitor Name</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Company</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Staff to Meet</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Department</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Purpose</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Total Members</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Members Out</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Pass Date</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-200">
                        {#each paginatedLogs as log (log.$id)}
                            <tr
                                on:click={() => { selectedVisitor = log; showModal = true; }}
                                class="hover:bg-gray-50 cursor-pointer transition"
                            >
                                <td class="px-6 py-4">
                                    {#if log.selfieFileId}
                                        {#if getSelfieUrl(log.selfieFileId)}
                                            <img 
                                                src={getSelfieUrl(log.selfieFileId)} 
                                                alt={log.visitorName}
                                                class="w-10 h-10 rounded-full object-cover"
                                                on:error={(e) => {
                                                    e.target.style.display = 'none';
                                                    e.target.nextElementSibling.style.display = 'flex';
                                                }}
                                            />
                                            <div class="w-10 h-10 rounded-full bg-gray-300 items-center justify-center text-white font-semibold hidden">
                                                {log.visitorName.charAt(0)}
                                            </div>
                                        {:else}
                                            <div class="w-10 h-10 rounded-full bg-gray-300 flex items-center justify-center text-white font-semibold">
                                                {log.visitorName.charAt(0)}
                                            </div>
                                        {/if}
                                    {:else}
                                        <div class="w-10 h-10 rounded-full bg-gray-300 flex items-center justify-center text-white font-semibold">
                                            {log.visitorName.charAt(0)}
                                        </div>
                                    {/if}
                                </td>
                                <td class="px-6 py-4 text-sm text-gray-900">{log.visitorName}</td>
                                <td class="px-6 py-4 text-sm text-gray-900">{log.companyName}</td>
                                <td class="px-6 py-4 text-sm text-gray-900">{log.staffName}</td>
                                <td class="px-6 py-4 text-sm text-gray-900">{log.departmentName}</td>
                                <td class="px-6 py-4 text-sm text-gray-600">{log.purpose.substring(0, 30)}...</td>
                                <td class="px-6 py-4 text-sm text-gray-900 text-center">
                                    <span class="font-semibold">{log.totalMembers || 1}</span>
                                </td>
                                <td class="px-6 py-4 text-sm text-center">
                                    {#if log.status === 'partial-checkout' || log.status === 'checked-out'}
                                        <span class="font-semibold text-orange-600">{parseInt(log.totalMembersOut) || 0}</span>
                                        <span class="text-xs text-gray-500 block">
                                            ({calculateMembersInside(log)} inside)
                                        </span>
                                    {:else}
                                        <span class="text-gray-400">-</span>
                                    {/if}
                                </td>
                                <td class="px-6 py-4">
                                    <span class="px-2 py-1 rounded-full text-xs font-semibold {getStatusBadge(log.status)}">
                                        {log.status === 'partial-checkout' ? 'PARTIAL OUT' : log.status.toUpperCase()}
                                    </span>
                                </td>
                                <td class="px-6 py-4 text-sm text-gray-900">
                                    {log.passDate || '-'}
                                </td>
                            </tr>
                        {/each}
                    </tbody>
                </table>
            </div>
        </div>

        <!-- Pagination -->
        <div class="flex justify-between items-center mt-4">
            <button
                on:click={() => currentPage = Math.max(1, currentPage - 1)}
                disabled={currentPage === 1}
                class="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 disabled:opacity-50"
            >
                Previous
            </button>
            <span class="text-sm text-gray-700">
                Page <span class="font-semibold">{currentPage}</span> of <span class="font-semibold">{Math.ceil(filteredLogs.length / pageSize) || 1}</span>
            </span>
            <button
                on:click={() => currentPage = Math.min(Math.ceil(filteredLogs.length / pageSize) || 1, currentPage + 1)}
                disabled={currentPage === Math.ceil(filteredLogs.length / pageSize) || filteredLogs.length === 0}
                class="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 disabled:opacity-50"
            >
                Next
            </button>
        </div>
    {/if}
</div>

<!-- Visitor Detail Modal -->
{#if showModal && selectedVisitor}
    <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
        <div class="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div class="p-6">
                <div class="flex items-center justify-between mb-4">
                    <h3 class="text-2xl font-bold text-gray-800">Visitor Details</h3>
                    <button on:click={() => showModal = false} class="text-gray-400 hover:text-gray-600">
                        <X class="w-6 h-6" />
                    </button>
                </div>

                <div class="space-y-4">
                    {#if selectedVisitor.selfieFileId && getSelfieUrl(selectedVisitor.selfieFileId)}
                        <div class="flex justify-center mb-4">
                            <img 
                                src={getSelfieUrl(selectedVisitor.selfieFileId)} 
                                alt={selectedVisitor.visitorName}
                                class="w-32 h-32 rounded-lg object-cover shadow-md"
                            />
                        </div>
                    {/if}

                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <p class="text-sm font-semibold text-gray-600">Visitor Name</p>
                            <p class="text-gray-900">{selectedVisitor.visitorName}</p>
                        </div>
                        <div>
                            <p class="text-sm font-semibold text-gray-600">Email</p>
                            <p class="text-gray-900">{selectedVisitor.visitorEmail}</p>
                        </div>
                        <div>
                            <p class="text-sm font-semibold text-gray-600">Phone</p>
                            <p class="text-gray-900">{selectedVisitor.visitorPhone}</p>
                        </div>
                        <div>
                            <p class="text-sm font-semibold text-gray-600">Company</p>
                            <p class="text-gray-900">{selectedVisitor.companyName}</p>
                        </div>
                        <div>
                            <p class="text-sm font-semibold text-gray-600">Staff to Meet</p>
                            <p class="text-gray-900">{selectedVisitor.staffName}</p>
                        </div>
                        <div>
                            <p class="text-sm font-semibold text-gray-600">Department</p>
                            <p class="text-gray-900">{selectedVisitor.departmentName}</p>
                        </div>
                        <div class="col-span-2">
                            <p class="text-sm font-semibold text-gray-600">Purpose</p>
                            <p class="text-gray-900">{selectedVisitor.purpose}</p>
                        </div>
                        <div class="col-span-2">
                            <p class="text-sm font-semibold text-gray-600">Products Description</p>
                            <p class="text-gray-900">{selectedVisitor.productsDesc || 'N/A'}</p>
                        </div>
                    </div>

                    <hr />

                    {#if selectedVisitor.totalMembers && selectedVisitor.totalMembers > 1}
                        <div class="bg-blue-50 rounded-lg p-4 border border-blue-200">
                            <h4 class="text-sm font-bold text-blue-900 mb-3">Group Visit Information</h4>
                            <div class="grid grid-cols-3 gap-4">
                                <div>
                                    <p class="text-xs font-semibold text-blue-600">Total Members</p>
                                    <p class="text-2xl font-bold text-blue-900">{selectedVisitor.totalMembers}</p>
                                </div>
                                <div>
                                    <p class="text-xs font-semibold text-orange-600">Checked Out</p>
                                    <p class="text-2xl font-bold text-orange-900">{parseInt(selectedVisitor.totalMembersOut) || 0}</p>
                                </div>
                                <div>
                                    <p class="text-xs font-semibold text-green-600">Currently Inside</p>
                                    <p class="text-2xl font-bold text-green-900">{calculateMembersInside(selectedVisitor)}</p>
                                </div>
                            </div>
                        </div>
                        <hr />
                    {/if}

                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <p class="text-sm font-semibold text-gray-600">Request Time</p>
                            <p class="text-gray-900">{formatDateTime(selectedVisitor.requestTime)}</p>
                        </div>
                        <div>
                            <p class="text-sm font-semibold text-gray-600">Approval Time</p>
                            <p class="text-gray-900">{formatDateTime(selectedVisitor.approvalTime)}</p>
                        </div>
                        <div>
                            <p class="text-sm font-semibold text-gray-600">Check-in Time</p>
                            <p class="text-gray-900">{formatDateTime(selectedVisitor.checkinTime)}</p>
                        </div>
                        <div>
                            <p class="text-sm font-semibold text-gray-600">Checkout Time</p>
                            <p class="text-gray-900">{formatDateTime(selectedVisitor.checkoutTime)}</p>
                        </div>
                    </div>

                    <hr />

                    <div>
                        <p class="text-sm font-semibold text-gray-600">Status</p>
                        <span class="inline-block mt-1 px-2 py-1 rounded-full text-xs font-semibold {getStatusBadge(selectedVisitor.status)}">
                            {selectedVisitor.status === 'partial-checkout' ? 'PARTIAL CHECKOUT' : selectedVisitor.status.toUpperCase()}
                        </span>
                    </div>

                    {#if selectedVisitor.notes}
                        <div>
                            <p class="text-sm font-semibold text-gray-600">Notes</p>
                            <p class="text-gray-900">{selectedVisitor.notes}</p>
                        </div>
                    {/if}

                    {#if selectedVisitor.rejectionReason}
                        <div>
                            <p class="text-sm font-semibold text-gray-600">Rejection Reason</p>
                            <p class="text-red-600">{selectedVisitor.rejectionReason}</p>
                        </div>
                    {/if}

                    {#if selectedVisitor.statusChangedBy}
                        <div>
                            <p class="text-sm font-semibold text-gray-600">Status Changed By</p>
                            <p class="text-gray-900">{selectedVisitor.statusChangedBy}</p>
                        </div>
                    {/if}
                </div>
            </div>
        </div>
    </div>
{/if}