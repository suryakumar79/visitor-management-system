<script>
    import { onMount } from 'svelte';
    import { 
        databases, 
        Query,
        VMS_DATABASE_ID,
        VISITORS_COLLECTION_ID
    } from '$lib/client';
    import { Search, ChevronLeft, ChevronRight, User, Mail, Phone, Building, LayoutGrid, List } from 'lucide-svelte';

    // View mode
    let viewMode = 'table';
    
    // Show faulty visitors toggle
    let showFaultyVisitors = false;

    // Filters
    let filters = {
        name: '',
        phone: '',
        email: '',
        company: '',
        sortBy: 'latest'
    };

    // Pagination
    let currentPage = 1;
    let itemsPerPage = 20;
    let totalVisitors = 0;
    let totalPages = 0;

    // Data
    let visitors = [];
    let allVisitors = [];
    let filteredVisitors = []; // OPTIMIZED: Separate filtered array
    let loading = true;
    let error = null;

    // OPTIMIZED: Debounce timer
    let searchTimeout;

    // OPTIMIZED: Cache for computed values
    let cachedPageNumbers = [];
    let lastPageCalc = { currentPage: 0, totalPages: 0 };

    onMount(async () => {
        await fetchVisitors();
        
        // Cleanup
        return () => {
            if (searchTimeout) clearTimeout(searchTimeout);
        };
    });

    async function fetchVisitors() {
        loading = true;
        error = null;
        
        try {
            let queries = [
                Query.limit(500), // OPTIMIZED: Fetch more at once for better client-side filtering
                Query.offset(0)
            ];

            // Apply sorting at database level
            switch(filters.sortBy) {
                case 'latest':
                    queries.push(Query.orderDesc('$createdAt'));
                    break;
                case 'oldest':
                    queries.push(Query.orderAsc('$createdAt'));
                    break;
                case 'a2z':
                    queries.push(Query.orderAsc('name'));
                    break;
                case 'z2a':
                    queries.push(Query.orderDesc('name'));
                    break;
            }

            const result = await databases.listDocuments(
                VMS_DATABASE_ID,
                VISITORS_COLLECTION_ID,
                queries
            );

            allVisitors = result.documents || [];
            
            // Apply filters
            applyFilters();

        } catch (err) {
            console.error('Error fetching visitors:', err);
            error = err.message || 'Failed to fetch visitors';
            visitors = [];
            allVisitors = [];
            filteredVisitors = [];
            totalVisitors = 0;
            totalPages = 0;
        } finally {
            loading = false;
        }
    }

    // OPTIMIZED: More efficient filtering with early returns and pre-lowercasing
    function applyFilters() {
        let filtered = allVisitors;

        // OPTIMIZED: Filter faulty/valid visitors first (most selective)
        if (showFaultyVisitors) {
            filtered = filtered.filter(v => 
                !v.name || !v.email || !v.phone || !v.companyName
            );
        } else {
            filtered = filtered.filter(v => 
                v.name && v.email && v.phone && v.companyName
            );
        }

        // OPTIMIZED: Early return if no text filters
        if (!filters.name && !filters.phone && !filters.email && !filters.company) {
            filteredVisitors = filtered;
        } else {
            // Pre-lowercase search terms once
            const lowerName = filters.name.toLowerCase();
            const lowerEmail = filters.email.toLowerCase();
            const lowerCompany = filters.company.toLowerCase();
            const phoneSearch = filters.phone;

            filtered = filtered.filter(v => {
                // Early returns on failed conditions
                if (filters.name && (!v.name || !v.name.toLowerCase().includes(lowerName))) {
                    return false;
                }
                if (filters.phone && (!v.phone || !v.phone.includes(phoneSearch))) {
                    return false;
                }
                if (filters.email && (!v.email || !v.email.toLowerCase().includes(lowerEmail))) {
                    return false;
                }
                if (filters.company && (!v.companyName || !v.companyName.toLowerCase().includes(lowerCompany))) {
                    return false;
                }
                return true;
            });
            
            filteredVisitors = filtered;
        }

        // Update totals
        totalVisitors = filteredVisitors.length;
        totalPages = Math.ceil(totalVisitors / itemsPerPage) || 1;

        // Ensure current page is valid
        if (currentPage > totalPages) {
            currentPage = totalPages;
        }

        // OPTIMIZED: Apply pagination
        const start = (currentPage - 1) * itemsPerPage;
        const end = start + itemsPerPage;
        visitors = filteredVisitors.slice(start, end);
    }

    function clearFilters() {
        filters = {
            name: '',
            phone: '',
            email: '',
            company: '',
            sortBy: 'latest'
        };
        currentPage = 1;
        applyFilters();
    }
    
    function toggleFaultyVisitors() {
        showFaultyVisitors = !showFaultyVisitors;
        currentPage = 1;
        filters.name = '';
        filters.phone = '';
        filters.email = '';
        filters.company = '';
        applyFilters();
    }

    // OPTIMIZED: Debounced search handler
    function handleSearch() {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            currentPage = 1;
            applyFilters();
        }, 200); // OPTIMIZED: Reduced from 300ms to 200ms for snappier feel
    }

    function goToPage(page) {
        if (page < 1 || page > totalPages) return;
        currentPage = page;
        applyFilters();
    }

    // OPTIMIZED: Memoized date formatting
    const dateFormatCache = new Map();
    
    function formatDate(dateString) {
        if (dateFormatCache.has(dateString)) {
            return dateFormatCache.get(dateString);
        }
        
        try {
            const formatted = new Date(dateString).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
            dateFormatCache.set(dateString, formatted);
            return formatted;
        } catch (err) {
            return 'Invalid date';
        }
    }

    // OPTIMIZED: Cached page numbers calculation
    function getPageNumbers() {
        // Return cached if same page/total
        if (lastPageCalc.currentPage === currentPage && lastPageCalc.totalPages === totalPages) {
            return cachedPageNumbers;
        }
        
        const pages = [];
        const maxPagesToShow = 5;
        
        let startPage = Math.max(1, currentPage - Math.floor(maxPagesToShow / 2));
        let endPage = Math.min(totalPages, startPage + maxPagesToShow - 1);
        
        if (endPage - startPage < maxPagesToShow - 1) {
            startPage = Math.max(1, endPage - maxPagesToShow + 1);
        }
        
        for (let i = startPage; i <= endPage; i++) {
            pages.push(i);
        }
        
        // Cache result
        cachedPageNumbers = pages;
        lastPageCalc = { currentPage, totalPages };
        
        return pages;
    }

    // OPTIMIZED: Reactive pagination
    $: paginatedVisitors = filteredVisitors.slice(
        (currentPage - 1) * itemsPerPage,
        currentPage * itemsPerPage
    );

    // OPTIMIZED: Reactive statements for efficiency
    $: if (filters.sortBy) {
        fetchVisitors();
    }
</script>

<svelte:head>
    <title>Visitor List - VMS</title>
</svelte:head>

<div class="p-6 bg-gray-50 min-h-screen">
    <!-- Header -->
    <div class="mb-6 flex items-center justify-between">
        <div>
            <h1 class="text-3xl font-bold text-gray-800">Visitor List</h1>
            <p class="text-gray-600 mt-1">Manage and view all registered visitors</p>
        </div>
        
        <div class="flex items-center gap-3">
            <!-- Faulty Visitors Toggle -->
            <button
                on:click={toggleFaultyVisitors}
                class="flex items-center gap-2 px-4 py-2 rounded-lg shadow transition {showFaultyVisitors ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-white text-gray-700 hover:bg-gray-100'}"
            >
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                {showFaultyVisitors ? 'Faulty Visitors' : 'Valid Visitors'}
            </button>
            
            <!-- View Toggle -->
            <div class="flex items-center gap-2 bg-white rounded-lg shadow p-1">
                <button
                    on:click={() => viewMode = 'table'}
                    class="p-2 rounded {viewMode === 'table' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'} transition"
                    title="Table View"
                >
                    <List class="w-5 h-5" />
                </button>
                <button
                    on:click={() => viewMode = 'grid'}
                    class="p-2 rounded {viewMode === 'grid' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'} transition"
                    title="Grid View"
                >
                    <LayoutGrid class="w-5 h-5" />
                </button>
            </div>
        </div>
    </div>

    <!-- Filters Section -->
    <div class="bg-white rounded-lg shadow p-6 mb-6">
        <div class="flex items-center justify-between mb-4">
            <h2 class="text-xl font-semibold text-gray-800">
                Search & Filter
                {#if showFaultyVisitors}
                    <span class="ml-2 text-sm font-normal text-red-600">(Showing incomplete records)</span>
                {/if}
            </h2>
            <button
                on:click={clearFilters}
                class="text-sm text-blue-600 hover:text-blue-800 font-medium"
            >
                Clear All
            </button>
        </div>

        {#if !showFaultyVisitors}
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
            <!-- Name Filter -->
            <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Visitor Name</label>
                <input
                    type="text"
                    bind:value={filters.name}
                    on:input={handleSearch}
                    placeholder="Search by name..."
                    class="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
            </div>

            <!-- Phone Filter -->
            <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
                <input
                    type="text"
                    bind:value={filters.phone}
                    on:input={handleSearch}
                    placeholder="Search by phone..."
                    class="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
            </div>

            <!-- Email Filter -->
            <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                    type="text"
                    bind:value={filters.email}
                    on:input={handleSearch}
                    placeholder="Search by email..."
                    class="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
            </div>

            <!-- Company Filter -->
            <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Company Name</label>
                <input
                    type="text"
                    bind:value={filters.company}
                    on:input={handleSearch}
                    placeholder="Search by company..."
                    class="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
            </div>

            <!-- Sort By -->
            <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Sort By</label>
                <select
                    bind:value={filters.sortBy}
                    class="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                    <option value="latest">Latest First</option>
                    <option value="oldest">Oldest First</option>
                    <option value="a2z">Name (A to Z)</option>
                    <option value="z2a">Name (Z to A)</option>
                </select>
            </div>
        </div>
        {:else}
        <div class="bg-red-50 border border-red-200 rounded-lg p-4">
            <p class="text-sm text-red-800">
                <strong>Faulty Visitors Mode:</strong> Displaying visitors with missing or incomplete information (name, email, phone, or company).
            </p>
        </div>
        {/if}
    </div>

    <!-- Results Count -->
    <div class="flex items-center justify-between mb-4">
        <p class="text-sm text-gray-600">
            Showing <span class="font-semibold">{visitors.length}</span> of <span class="font-semibold">{totalVisitors}</span> visitors
        </p>
        <p class="text-sm text-gray-600">
            Page <span class="font-semibold">{currentPage}</span> of <span class="font-semibold">{totalPages}</span>
        </p>
    </div>

    {#if loading}
        <!-- Loading State -->
        <div class="bg-white rounded-lg shadow p-8">
            <div class="flex flex-col items-center justify-center">
                <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
                <p class="text-gray-600">Loading visitors...</p>
            </div>
        </div>
    {:else if error}
        <!-- Error State -->
        <div class="bg-white rounded-lg shadow p-8">
            <div class="flex flex-col items-center justify-center text-center">
                <div class="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4">
                    <User class="w-8 h-8 text-red-600" />
                </div>
                <h3 class="text-xl font-semibold text-gray-800 mb-2">Error Loading Visitors</h3>
                <p class="text-gray-600 mb-4">{error}</p>
                <button
                    on:click={fetchVisitors}
                    class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                >
                    Try Again
                </button>
            </div>
        </div>
    {:else if visitors.length === 0}
        <!-- Empty State -->
        <div class="bg-white rounded-lg shadow p-8">
            <div class="flex flex-col items-center justify-center text-center">
                <User class="w-16 h-16 text-gray-400 mb-4" />
                <h3 class="text-xl font-semibold text-gray-800 mb-2">No Visitors Found</h3>
                <p class="text-gray-600">
                    {#if filters.name || filters.phone || filters.email || filters.company}
                        Try adjusting your search filters
                    {:else}
                        No visitors have been registered yet
                    {/if}
                </p>
            </div>
        </div>
    {:else}
        {#if viewMode === 'table'}
            <!-- Table View -->
            <div class="bg-white rounded-lg shadow overflow-hidden">
                <div class="overflow-x-auto">
                    <table class="w-full">
                        <thead class="bg-gray-50 border-b">
                            <tr>
                                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
                                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Phone</th>
                                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Company</th>
                                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Registered</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-gray-200">
                            {#each visitors as visitor (visitor.$id)}
                                <tr class="hover:bg-gray-50 transition">
                                    <td class="px-6 py-4">
                                        <div class="flex items-center gap-3">
                                            <div class="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-indigo-600 flex items-center justify-center text-white font-semibold">
                                                {(visitor.name || 'U').charAt(0).toUpperCase()}
                                            </div>
                                            <span class="font-medium text-gray-900">{visitor.name || '—'}</span>
                                        </div>
                                    </td>
                                    <td class="px-6 py-4 text-sm text-gray-900">{visitor.email || '—'}</td>
                                    <td class="px-6 py-4 text-sm text-gray-900">{visitor.phone || '—'}</td>
                                    <td class="px-6 py-4 text-sm text-gray-900">{visitor.companyName || '—'}</td>
                                    <td class="px-6 py-4 text-sm text-gray-600">{formatDate(visitor.$createdAt)}</td>
                                </tr>
                            {/each}
                        </tbody>
                    </table>
                </div>
            </div>
        {:else}
            <!-- Grid View -->
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {#each visitors as visitor (visitor.$id)}
                    <div class="bg-white rounded-lg shadow hover:shadow-lg transition p-6">
                        <!-- Avatar -->
                        <div class="flex justify-center mb-4">
                            <div class="w-16 h-16 rounded-full bg-gradient-to-br from-blue-400 to-indigo-600 flex items-center justify-center text-white text-2xl font-bold shadow-lg">
                                {(visitor.name || 'U').charAt(0).toUpperCase()}
                            </div>
                        </div>

                        <!-- Visitor Info -->
                        <div class="text-center mb-4">
                            <h3 class="text-lg font-bold text-gray-800 mb-1">{visitor.name || '—'}</h3>
                            <p class="text-sm text-gray-600">{visitor.companyName || '—'}</p>
                        </div>

                        <!-- Contact Details -->
                        <div class="space-y-2 text-sm">
                            <div class="flex items-start gap-2">
                                <Mail class="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
                                <span class="text-gray-700 break-all">{visitor.email || '—'}</span>
                            </div>
                            <div class="flex items-center gap-2">
                                <Phone class="w-4 h-4 text-gray-400 flex-shrink-0" />
                                <span class="text-gray-700">{visitor.phone || '—'}</span>
                            </div>
                            <div class="pt-2 border-t border-gray-100">
                                <span class="text-gray-600 text-xs">Registered: {formatDate(visitor.$createdAt)}</span>
                            </div>
                        </div>
                    </div>
                {/each}
            </div>
        {/if}

        <!-- Pagination -->
        {#if totalPages > 1}
            <div class="bg-white rounded-lg shadow p-4 mt-6">
                <div class="flex items-center justify-between">
                    <!-- Previous Button -->
                    <button
                        on:click={() => goToPage(currentPage - 1)}
                        disabled={currentPage === 1}
                        class="flex items-center gap-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
                    >
                        <ChevronLeft class="w-4 h-4" />
                        Previous
                    </button>

                    <!-- Page Numbers -->
                    <div class="flex items-center gap-2">
                        {#if getPageNumbers()[0] > 1}
                            <button
                                on:click={() => goToPage(1)}
                                class="px-3 py-1 rounded hover:bg-gray-100 text-gray-700"
                            >
                                1
                            </button>
                            {#if getPageNumbers()[0] > 2}
                                <span class="text-gray-400">...</span>
                            {/if}
                        {/if}

                        {#each getPageNumbers() as page}
                            <button
                                on:click={() => goToPage(page)}
                                class="px-3 py-1 rounded {currentPage === page ? 'bg-blue-600 text-white' : 'hover:bg-gray-100 text-gray-700'} transition"
                            >
                                {page}
                            </button>
                        {/each}

                        {#if getPageNumbers()[getPageNumbers().length - 1] < totalPages}
                            {#if getPageNumbers()[getPageNumbers().length - 1] < totalPages - 1}
                                <span class="text-gray-400">...</span>
                            {/if}
                            <button
                                on:click={() => goToPage(totalPages)}
                                class="px-3 py-1 rounded hover:bg-gray-100 text-gray-700"
                            >
                                {totalPages}
                            </button>
                        {/if}
                    </div>

                    <!-- Next Button -->
                    <button
                        on:click={() => goToPage(currentPage + 1)}
                        disabled={currentPage === totalPages}
                        class="flex items-center gap-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
                    >
                        Next
                        <ChevronRight class="w-4 h-4" />
                    </button>
                </div>
            </div>
        {/if}
    {/if}
</div>