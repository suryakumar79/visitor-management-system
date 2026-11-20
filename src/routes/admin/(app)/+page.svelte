<script>
    import Chart from 'chart.js/auto';
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
    import { Clock, CheckCircle, XCircle, Users, X, TrendingUp, Calendar } from 'lucide-svelte';

    // Stats
    let stats = {
        checkedInToday: 0,
        totalVisitorsIn: 0,
        checkedOutToday: 0,
        previousDayUnclosed: 0,
        last30Days: 0,
        thisYear: 0
    };

    // Chart data
    let last30DaysData = [];
    let yearlyMonthlyData = [];
    let chartCanvas30Days;
    let chartCanvasYearly;
    let chart30Days;
    let chartYearly;
    let chartsLoaded = false;

    // Filters with date range
    let filters = {
        staffName: '',
        position: '',
        department: '',
        visitorName: '',
        company: '',
        searchTerm: '',
        fromDate: '',
        toDate: ''
    };

    let datesInitialized = false;

    // Dropdown data
    let staffList = [];
    let positionsList = [];
    let departmentsList = [];
    let companiesList = [];

    // OPTIMIZED: Lookup maps for O(1) access
    let departmentsMap = new Map();
    let positionsMap = new Map();
    let staffMap = new Map();

    // Visitor logs
    let visitorLogs = [];
    let filteredLogs = [];

    // Pagination
    const pageSize = 20;
    let currentPage = 1;
    let paginatedLogs = [];
    let totalPages = 1;

    // Reactive filtered positions
    let filteredPositionsList = [];

    // Modal
    let showModal = false;
    let selectedVisitor = null;

    // Loading states
    let loading = true;
    let chartsLoading = false;

    // Auto-refresh
    let refreshInterval;

    // OPTIMIZED: Cache configuration
    const CACHE_KEY = 'vms_dropdown_cache';
    const STATS_CACHE_KEY = 'vms_stats_cache';
    const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
    const STATS_CACHE_DURATION = 2 * 60 * 1000; // 2 minutes for stats

    // OPTIMIZED: Debounce filters
    let filterTimeout;

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

    function getCachedStats() {
        try {
            const cached = localStorage.getItem(STATS_CACHE_KEY);
            if (cached) {
                const { data, timestamp } = JSON.parse(cached);
                if (Date.now() - timestamp < STATS_CACHE_DURATION) {
                    return data;
                }
            }
        } catch (e) {
            console.error('Stats cache read error:', e);
        }
        return null;
    }

    function setCachedStats(data) {
        try {
            localStorage.setItem(STATS_CACHE_KEY, JSON.stringify({
                data,
                timestamp: Date.now()
            }));
        } catch (e) {
            console.error('Stats cache write error:', e);
        }
    }

    function getISTDateString() {
        const now = new Date();
        const istOffset = 5.5 * 60 * 60 * 1000;
        const istDate = new Date(now.getTime() + istOffset);
        
        const year = istDate.getUTCFullYear();
        const month = String(istDate.getUTCMonth() + 1).padStart(2, '0');
        const day = String(istDate.getUTCDate()).padStart(2, '0');
        
        return `${year}-${month}-${day}`;
    }

    function getISTStartOfDay(dateString) {
        const [year, month, day] = dateString.split('-').map(Number);
        const istDate = new Date(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00+05:30`);
        return istDate.toISOString();
    }

    function getISTEndOfDay(dateString) {
        const [year, month, day] = dateString.split('-').map(Number);
        const istDate = new Date(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T23:59:59.999+05:30`);
        return istDate.toISOString();
    }

    // Reactive: Create charts when canvases are mounted AND data is loaded
    $: if (chartCanvas30Days && chartCanvasYearly && last30DaysData.length > 0 && yearlyMonthlyData.length > 0 && !chartsLoaded) {
        
        createCharts();
        chartsLoaded = true;
    }

    onMount(async () => {
        const todayIST = getISTDateString();
        filters.fromDate = todayIST;
        filters.toDate = todayIST;
        datesInitialized = true;
        
        // Load cached stats immediately for faster initial render
        const cachedStats = getCachedStats();
        if (cachedStats) {
            stats = cachedStats.stats;
            last30DaysData = cachedStats.last30DaysData || [];
            yearlyMonthlyData = cachedStats.yearlyMonthlyData || [];
        }
        
        // Load dropdown data first (critical for filters)
        await fetchDropdownData();
        
        // Load visitor logs for today
        await fetchVisitorLogs();
        
        // Fetch fresh stats and chart data in background
        Promise.all([
            fetchDashboardStats(),
            fetchLast30DaysData(),
            fetchYearlyData()
        ]).then(() => {
            chartsLoading = false;
        });
        
        loading = false;

        // Refresh interval - only refresh stats and logs, not charts every time
        refreshInterval = setInterval(async () => {
            await Promise.all([
                fetchDashboardStats(),
                fetchVisitorLogs()
            ]);
        }, 60000); // Increased to 60 seconds to reduce load

        return () => {
            if (refreshInterval) clearInterval(refreshInterval);
            if (filterTimeout) clearTimeout(filterTimeout);
            if (chart30Days) chart30Days.destroy();
            if (chartYearly) chartYearly.destroy();
        };
    });

    async function fetchLast30DaysData() {
        const now = new Date();
        const thirtyDaysAgo = new Date(now);
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        try {
            // Single query for all 30 days data
            const result = await databases.listDocuments(
                VMS_DATABASE_ID,
                VISITOR_LOGS_COLLECTION_ID,
                [
                    Query.greaterThanEqual('requestTime', thirtyDaysAgo.toISOString()),
                    Query.limit(5000)
                ]
            );
            
            // Process data client-side
            const dailyCounts = new Map();
            
            result.documents.forEach(doc => {
                const date = new Date(doc.requestTime);
                const dateKey = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                dailyCounts.set(dateKey, (dailyCounts.get(dateKey) || 0) + 1);
            });
            
            // Generate last 30 days array
            const data = [];
            for (let i = 29; i >= 0; i--) {
                const date = new Date(now);
                date.setDate(date.getDate() - i);
                const dateKey = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                
                data.push({
                    date: dateKey,
                    count: dailyCounts.get(dateKey) || 0
                });
            }
            
            last30DaysData = data;
            stats.last30Days = data.reduce((sum, day) => sum + day.count, 0);
            
            // Cache the stats
            setCachedStats({
                stats,
                last30DaysData,
                yearlyMonthlyData
            });
        } catch (error) {
            console.error('Error fetching 30 days data:', error);
        }
    }

    async function fetchYearlyData() {
        const now = new Date();
        const currentYear = now.getFullYear();
        const startOfYear = new Date(currentYear, 0, 1);
        
        try {
            // Single query for entire year
            const result = await databases.listDocuments(
                VMS_DATABASE_ID,
                VISITOR_LOGS_COLLECTION_ID,
                [
                    Query.greaterThanEqual('requestTime', startOfYear.toISOString()),
                    Query.limit(5000)
                ]
            );
            
            // Process data client-side
            const monthlyCounts = new Array(12).fill(0);
            
            result.documents.forEach(doc => {
                const date = new Date(doc.requestTime);
                const month = date.getMonth();
                monthlyCounts[month]++;
            });
            
            // Generate monthly data
            const data = [];
            for (let month = 0; month < 12; month++) {
                const monthDate = new Date(currentYear, month, 1);
                data.push({
                    month: monthDate.toLocaleDateString('en-US', { month: 'short' }),
                    count: monthlyCounts[month]
                });
            }
            
            yearlyMonthlyData = data;
            stats.thisYear = data.reduce((sum, month) => sum + month.count, 0);
            
            // Cache the stats
            setCachedStats({
                stats,
                last30DaysData,
                yearlyMonthlyData
            });
        } catch (error) {
            console.error('Error fetching yearly data:', error);
        }
    }

    function createCharts() {
        buildCharts();
    }

    function buildCharts() {
        console.log('Building charts...', {
            has30DaysData: last30DaysData.length > 0,
            hasYearlyData: yearlyMonthlyData.length > 0,
            has30DaysCanvas: !!chartCanvas30Days,
            hasYearlyCanvas: !!chartCanvasYearly
        });

        // Last 30 Days Chart
        if (chartCanvas30Days && last30DaysData.length > 0) {
            try {
                const ctx30Days = chartCanvas30Days.getContext('2d');
                chart30Days = new Chart(ctx30Days, {
                    type: 'line',
                    data: {
                        labels: last30DaysData.map(d => d.date),
                        datasets: [{
                            label: 'Visitors',
                            data: last30DaysData.map(d => d.count),
                            borderColor: 'rgb(59, 130, 246)',
                            backgroundColor: 'rgba(59, 130, 246, 0.1)',
                            fill: true,
                            tension: 0.4,
                            pointRadius: 3,
                            pointHoverRadius: 6,
                            pointBackgroundColor: 'rgb(59, 130, 246)',
                            pointBorderColor: '#fff',
                            pointBorderWidth: 2
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: {
                                display: false
                            },
                            tooltip: {
                                backgroundColor: 'rgba(0, 0, 0, 0.8)',
                                padding: 12,
                                titleColor: '#fff',
                                bodyColor: '#fff',
                                displayColors: false,
                                callbacks: {
                                    label: function(context) {
                                        return `Visitors: ${context.parsed.y}`;
                                    }
                                }
                            }
                        },
                        scales: {
                            y: {
                                beginAtZero: true,
                                ticks: {
                                    stepSize: 1,
                                    color: '#6b7280'
                                },
                                grid: {
                                    color: 'rgba(0, 0, 0, 0.05)'
                                }
                            },
                            x: {
                                ticks: {
                                    color: '#6b7280',
                                    maxRotation: 45,
                                    minRotation: 45
                                },
                                grid: {
                                    display: false
                                }
                            }
                        }
                    }
                });
                
            } catch (error) {
                console.error('Error creating 30 days chart:', error);
            }
        } else {
            console.warn('Cannot create 30 days chart:', {
                hasCanvas: !!chartCanvas30Days,
                dataLength: last30DaysData.length
            });
        }

        // Yearly Chart
        if (chartCanvasYearly && yearlyMonthlyData.length > 0) {
            try {
                const ctxYearly = chartCanvasYearly.getContext('2d');
                chartYearly = new Chart(ctxYearly, {
                    type: 'bar',
                    data: {
                        labels: yearlyMonthlyData.map(d => d.month),
                        datasets: [{
                            label: 'Visitors',
                            data: yearlyMonthlyData.map(d => d.count),
                            backgroundColor: 'rgba(16, 185, 129, 0.8)',
                            borderColor: 'rgb(16, 185, 129)',
                            borderWidth: 2,
                            borderRadius: 6,
                            hoverBackgroundColor: 'rgba(16, 185, 129, 1)'
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: {
                                display: false
                            },
                            tooltip: {
                                backgroundColor: 'rgba(0, 0, 0, 0.8)',
                                padding: 12,
                                titleColor: '#fff',
                                bodyColor: '#fff',
                                displayColors: false,
                                callbacks: {
                                    label: function(context) {
                                        return `Visitors: ${context.parsed.y}`;
                                    }
                                }
                            }
                        },
                        scales: {
                            y: {
                                beginAtZero: true,
                                ticks: {
                                    stepSize: 1,
                                    color: '#6b7280'
                                },
                                grid: {
                                    color: 'rgba(0, 0, 0, 0.05)'
                                }
                            },
                            x: {
                                ticks: {
                                    color: '#6b7280'
                                },
                                grid: {
                                    display: false
                                }
                            }
                        }
                    }
                });
                
            } catch (error) {
                 console.error('Error creating yearly chart:', error);
            }
        } else {
            console.warn('Cannot create yearly chart:', {
                hasCanvas: !!chartCanvasYearly,
                dataLength: yearlyMonthlyData.length
            });
        }
    }

    function updateCharts() {
        if (chart30Days && last30DaysData.length > 0) {
            chart30Days.data.labels = last30DaysData.map(d => d.date);
            chart30Days.data.datasets[0].data = last30DaysData.map(d => d.count);
            chart30Days.update('none'); // Use 'none' mode for faster updates
        }

        if (chartYearly && yearlyMonthlyData.length > 0) {
            chartYearly.data.labels = yearlyMonthlyData.map(d => d.month);
            chartYearly.data.datasets[0].data = yearlyMonthlyData.map(d => d.count);
            chartYearly.update('none');
        }
    }

    // OPTIMIZED: Debounced filter application
    function scheduleFilterUpdate() {
        clearTimeout(filterTimeout);
        filterTimeout = setTimeout(() => {
            applyFilters(filters, visitorLogs);
        }, 150);
    }

    // OPTIMIZED: Watch filters with debouncing
    $: {
        if (filters.visitorName || filters.searchTerm) {
            scheduleFilterUpdate();
        } else {
            applyFilters(filters, visitorLogs);
        }
        
        if (filters.department) {
            filteredPositionsList = positionsList.filter(p => p.departmentId === filters.department);
            if (filters.position && !filteredPositionsList.find(p => p.$id === filters.position)) {
                filters.position = '';
            }
        } else {
            filteredPositionsList = positionsList;
        }
    }

    // OPTIMIZED: Efficient pagination - recalculate total pages and slice
    $: {
        totalPages = Math.max(1, Math.ceil(filteredLogs.length / pageSize));
        
        // Ensure current page doesn't exceed total pages
        if (currentPage > totalPages) {
            currentPage = totalPages;
        }
        
        const start = (currentPage - 1) * pageSize;
        const end = start + pageSize;
        paginatedLogs = filteredLogs.slice(start, end);
    }

    function getLastStatusDate(log) {
        // Return the most recent status change date
        return log.checkoutTime || log.checkinTime || log.approvalTime || log.requestTime;
    }

    async function fetchDashboardStats() {
        const now = new Date();
        const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const todayISO = todayDate.toISOString();

        const thirtyDaysAgo = new Date(todayDate);
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const thirtyDaysAgoISO = thirtyDaysAgo.toISOString();

        try {
            // OPTIMIZED: Use limit(100) for counts instead of 5000
            const [
                checkedInToday,
                currentlyInsideCheckedIn,
                currentlyInsidePartial,
                allCheckedOut,
                unclosedLast30Days
            ] = await Promise.all([
                databases.listDocuments(VMS_DATABASE_ID, VISITOR_LOGS_COLLECTION_ID, [
                    Query.greaterThanEqual('checkinTime', todayISO),
                    Query.limit(1) // We only need the count
                ]),
                databases.listDocuments(VMS_DATABASE_ID, VISITOR_LOGS_COLLECTION_ID, [
                    Query.equal('status', 'checked-in'),
                    Query.limit(1000) // Need full list for member calculations
                ]),
                databases.listDocuments(VMS_DATABASE_ID, VISITOR_LOGS_COLLECTION_ID, [
                    Query.equal('status', 'partial-checkout'),
                    Query.limit(1000)
                ]),
                databases.listDocuments(VMS_DATABASE_ID, VISITOR_LOGS_COLLECTION_ID, [
                    Query.equal('status', 'checked-out'),
                    Query.greaterThanEqual('checkoutTime', todayISO),
                    Query.limit(1)
                ]),
                databases.listDocuments(VMS_DATABASE_ID, VISITOR_LOGS_COLLECTION_ID, [
                    Query.greaterThanEqual('checkinTime', thirtyDaysAgoISO),
                    Query.lessThan('checkinTime', todayISO),
                    Query.or([
                        Query.equal('status', 'checked-in'),
                        Query.equal('status', 'partial-checkout')
                    ]),
                    Query.limit(1)
                ])
            ]);

            const allCurrentlyInside = [
                ...currentlyInsideCheckedIn.documents,
                ...currentlyInsidePartial.documents
            ];

            const totalMembersIn = allCurrentlyInside.reduce((sum, log) => {
                const totalMembers = log.totalMembers || 1;
                const totalMembersOut = parseInt(log.totalMembersOut) || 0;
                return sum + (totalMembers - totalMembersOut);
            }, 0);

            stats.checkedInToday = checkedInToday.total;
            stats.totalVisitorsIn = totalMembersIn;
            stats.checkedOutToday = allCheckedOut.total;
            stats.previousDayUnclosed = unclosedLast30Days.total;
            
            // Cache stats
            setCachedStats({
                stats,
                last30DaysData,
                yearlyMonthlyData
            });
        } catch (error) {
            console.error('Error fetching stats:', error);
        }
    }

    async function fetchDropdownData() {
        const cached = getCachedData();
        if (cached) {
            departmentsList = cached.departments;
            positionsList = cached.positions;
            staffList = cached.staff;
            companiesList = cached.companies;
            
            // OPTIMIZED: Build Maps for O(1) lookup
            departmentsMap = new Map(departmentsList.map(d => [d.$id, d.name]));
            positionsMap = new Map(positionsList.map(p => [p.$id, p.name]));
            staffMap = new Map(staffList.map(s => [s.$id, s.name]));

            
            return;
        }

        try {
            // OPTIMIZED: Parallel data fetching
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

            // OPTIMIZED: Build Maps
            departmentsMap = new Map(departmentsList.map(d => [d.$id, d.name]));
            positionsMap = new Map(positionsList.map(p => [p.$id, p.name]));
            staffMap = new Map(staffList.map(s => [s.$id, s.name]));

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

    async function fetchVisitorLogs() {
        try {
            const fromISO = getISTStartOfDay(filters.fromDate);
            const toISO = getISTEndOfDay(filters.toDate);

            // ✅ Calculate window based on selected range
            // Add extra buffer (30 days back from fromDate) to catch
            // passes requested before the range but status-changed within it
            const windowStart = new Date(fromISO);
            windowStart.setDate(windowStart.getDate() - 30); // 30 day buffer

            const result = await databases.listDocuments(
                VMS_DATABASE_ID,
                VISITOR_LOGS_COLLECTION_ID,
                [
                    Query.greaterThanEqual('$updatedAt', windowStart.toISOString()),
                    Query.lessThanEqual('$updatedAt', toISO),
                    Query.orderDesc('$updatedAt'),
                    Query.limit(5000)
                ]
            );

            const allLogs = result.documents.map(log => ({
                ...log,
                departmentName: departmentsMap.get(log.departmentId) || 'Unknown',
                positionName: positionsMap.get(log.positionId) || 'Unknown',
                staffNameResolved: staffMap.get(log.staffId) || log.staffName || 'Unknown',
                lastStatusDate: getLastStatusDate(log)
            }));

            // ✅ Filter client-side by lastStatusDate within exact selected range
            visitorLogs = allLogs.filter(log => {
                const lastDate = log.lastStatusDate;
                if (!lastDate) return false;
                return lastDate >= fromISO && lastDate <= toISO;
            });

            filteredLogs = visitorLogs;
            
        } catch (error) {
            console.error('Error fetching visitor logs:', error);
        }
    }

    // OPTIMIZED: More efficient filtering with early returns
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
            // Early returns for failed conditions
            if (currentFilters.staffName && log.staffId !== currentFilters.staffName) return false;
            if (currentFilters.position && log.positionId !== currentFilters.position) return false;
            if (currentFilters.department && log.departmentId !== currentFilters.department) return false;
            if (currentFilters.company && log.companyName !== currentFilters.company) return false;
            
            if (currentFilters.visitorName && !log.visitorName.toLowerCase().includes(lowerVisitorName)) {
                return false;
            }
            
            if (currentFilters.searchTerm) {
                const emailMatch = log.visitorEmail.toLowerCase().includes(lowerSearchTerm);
                const phoneMatch = log.visitorPhone.includes(currentFilters.searchTerm);
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
        const todayIST = getISTDateString();
        filters = {
            staffName: '',
            position: '',
            department: '',
            visitorName: '',
            company: '',
            searchTerm: '',
            fromDate: todayIST,
            toDate: todayIST
        };
        fetchVisitorLogs();
    }

    async function handleMarkAsCheckedOut(logId, event) {
        event.stopPropagation();
        
        if (!confirm('Mark this visitor as checked out?')) return;

        try {
            const log = await databases.getDocument(
                VMS_DATABASE_ID,
                VISITOR_LOGS_COLLECTION_ID,
                logId
            );

            const totalMembers = log.totalMembers || 1;
            const checkinDate = new Date(log.checkinTime);
            const checkinDateOnly = new Date(
                checkinDate.getFullYear(),
                checkinDate.getMonth(),
                checkinDate.getDate()
            );

            const currentDate = new Date();
            const currentDateOnly = new Date(
                currentDate.getFullYear(),
                currentDate.getMonth(),
                currentDate.getDate()
            );

            let checkoutDateTime;

            if (checkinDateOnly.getTime() === currentDateOnly.getTime()) {
                checkoutDateTime = new Date();
            } else {
                checkoutDateTime = new Date(
                    checkinDate.getFullYear(),
                    checkinDate.getMonth(),
                    checkinDate.getDate(),
                    23, 59, 0, 0
                );
            }

            await databases.updateDocument(
                VMS_DATABASE_ID,
                VISITOR_LOGS_COLLECTION_ID,
                logId,
                {
                    status: 'checked-out',
                    checkoutTime: checkoutDateTime.toISOString(),
                    totalMembersOut: totalMembers.toString(),
                    statusChangedBy: 'Admin'
                }
            );

            alert('Visitor marked as checked out!');
            
            // OPTIMIZED: Parallel refresh
            await Promise.all([
                fetchVisitorLogs(),
                fetchDashboardStats()
            ]);
        } catch (error) {
            console.error('Error marking as checked out:', error);
            alert('Failed to mark as checked out. Please try again.');
        }
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

    function formatDateTime(dateString) {
        if (!dateString) return '-';
        return new Date(dateString).toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    // OPTIMIZED: Memoize selfie URLs
    const selfieUrlCache = new Map();
    
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

    // FIXED: Calculate members inside based on status
    function calculateMembersInside(log) {
        // Only show members inside if status is checked-in or partial-checkout
        if (log.status === 'checked-in' || log.status === 'partial-checkout') {
            const totalMembers = log.totalMembers || 1;
            const membersOut = parseInt(log.totalMembersOut) || 0;
            return totalMembers - membersOut;
        }
        // For pending, approved, rejected, checked-out: return 0
        return 0;
    }
</script>

<svelte:head>
    <title>Dashboard - VMS</title>
</svelte:head>

<div class="p-6 bg-gray-50 min-h-screen">
    <div class="mb-6">
        <h1 class="text-3xl font-bold text-gray-800">Dashboard</h1>
        <p class="text-gray-600 mt-1">Today's visitor activities at a glance</p>
    </div>

    {#if loading}
        <div class="flex justify-center items-center h-64">
            <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
    {:else}
        <!-- Stats Cards -->
        <div class="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
            <div class="bg-white rounded-lg shadow p-6 border-l-4 border-blue-500">
                <div class="flex items-center justify-between">
                    <div>
                        <p class="text-sm text-gray-600">Checked In Today</p>
                        <p class="text-2xl font-bold text-gray-800">{stats.checkedInToday}</p>
                    </div>
                    <Clock class="w-10 h-10 text-blue-500" />
                </div>
            </div>

            <div class="bg-white rounded-lg shadow p-6 border-l-4 border-green-500">
                <div class="flex items-center justify-between">
                    <div>
                        <p class="text-sm text-gray-600">Total Visitors In</p>
                        <p class="text-2xl font-bold text-gray-800">{stats.totalVisitorsIn}</p>
                    </div>
                    <Users class="w-10 h-10 text-green-500" />
                </div>
            </div>

            <div class="bg-white rounded-lg shadow p-6 border-l-4 border-purple-500">
                <div class="flex items-center justify-between">
                    <div>
                        <p class="text-sm text-gray-600">Checked Out Today</p>
                        <p class="text-2xl font-bold text-gray-800">{stats.checkedOutToday}</p>
                    </div>
                    <CheckCircle class="w-10 h-10 text-purple-500" />
                </div>
            </div>

            <div class="bg-white rounded-lg shadow p-6 border-l-4 border-red-500">
                <div class="flex items-center justify-between">
                    <div>
                        <p class="text-sm text-gray-600">Unclosed (Last 30 Days)</p>
                        <p class="text-2xl font-bold text-gray-800">{stats.previousDayUnclosed}</p>
                    </div>
                    <XCircle class="w-10 h-10 text-red-500" />
                </div>
            </div>

            <div class="bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg shadow-lg p-6 border-l-4 border-blue-700 text-white">
                <div class="flex items-center justify-between">
                    <div>
                        <p class="text-sm text-blue-100">Last 30 Days</p>
                        <p class="text-2xl font-bold">{stats.last30Days}</p>
                    </div>
                    <TrendingUp class="w-10 h-10 text-blue-100" />
                </div>
            </div>

            <div class="bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-lg shadow-lg p-6 border-l-4 border-emerald-700 text-white">
                <div class="flex items-center justify-between">
                    <div>
                        <p class="text-sm text-emerald-100">This Year</p>
                        <p class="text-2xl font-bold">{stats.thisYear}</p>
                    </div>
                    <Calendar class="w-10 h-10 text-emerald-100" />
                </div>
            </div>
        </div>

        <!-- Charts Section -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <!-- Last 30 Days Chart -->
            <div class="bg-white rounded-lg shadow-lg p-6">
                <div class="mb-4">
                    <h2 class="text-xl font-bold text-gray-800 flex items-center gap-2">
                        <TrendingUp class="w-6 h-6 text-blue-600" />
                        Visitor Trend - Last 30 Days
                    </h2>
                    <p class="text-sm text-gray-600 mt-1">Daily visitor count over the past month</p>
                </div>
                <div class="h-80">
                    {#if chartsLoading}
                        <div class="flex justify-center items-center h-full">
                            <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                        </div>
                    {:else}
                        <canvas bind:this={chartCanvas30Days}></canvas>
                    {/if}
                </div>
            </div>

            <!-- Yearly Chart -->
            <div class="bg-white rounded-lg shadow-lg p-6">
                <div class="mb-4">
                    <h2 class="text-xl font-bold text-gray-800 flex items-center gap-2">
                        <Calendar class="w-6 h-6 text-emerald-600" />
                        Monthly Visitors - {new Date().getFullYear()}
                    </h2>
                    <p class="text-sm text-gray-600 mt-1">Visitor distribution throughout the year</p>
                </div>
                <div class="h-80">
                    {#if chartsLoading}
                        <div class="flex justify-center items-center h-full">
                            <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600"></div>
                        </div>
                    {:else}
                        <canvas bind:this={chartCanvasYearly}></canvas>
                    {/if}
                </div>
            </div>
        </div>

        <!-- Filters Section -->
        <div class="bg-white rounded-lg shadow p-6 mb-6">
            <div class="flex items-center justify-between mb-4">
                <h2 class="text-xl font-semibold text-gray-800">Filters</h2>
                <div class="flex gap-3">
                    <button
                        on:click={() => {
                            localStorage.removeItem(CACHE_KEY);
                            localStorage.removeItem(STATS_CACHE_KEY);
                            fetchDropdownData();
                            alert('Cache refreshed!');
                        }}
                        class="text-sm text-blue-600 hover:text-blue-800 font-medium"
                    >
                        Refresh Dropdowns
                    </button>
                    |
                    <button
                        on:click={clearFilters}
                        class="text-sm text-blue-600 hover:text-blue-800 font-medium"
                    >
                        Clear All Filters
                    </button>
                </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-3 gap-4">
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">From Date</label>
                    <input
                        type="date"
                        bind:value={filters.fromDate}
                        on:change={fetchVisitorLogs}
                        class="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                </div>

                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">To Date</label>
                    <input
                        type="date"
                        bind:value={filters.toDate}
                        on:change={fetchVisitorLogs}
                        class="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                </div>

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

                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">Visitor Name</label>
                    <input
                        type="text"
                        bind:value={filters.visitorName}
                        placeholder="Search visitor..."
                        class="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                </div>

                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">Email/Phone</label>
                    <input
                        type="text"
                        bind:value={filters.searchTerm}
                        placeholder="Search email or phone..."
                        class="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                </div>
            </div>
        </div>

        <div class="flex items-center justify-between mb-4">
            <p class="text-sm text-gray-600">
                Showing <span class="font-semibold">{paginatedLogs.length}</span> of 
                <span class="font-semibold">{filteredLogs.length}</span> visitor logs 
                {#if filters.fromDate === filters.toDate}
                    (Date: {new Date(filters.fromDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })})
                {:else}
                    (From: {new Date(filters.fromDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} 
                    To: {new Date(filters.toDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })})
                {/if}
            </p>
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
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
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
                                <td class="px-6 py-4">
                                    {#if log.status === 'checked-in' || log.status === 'partial-checkout'}
                                        <button
                                            on:click={(e) => handleMarkAsCheckedOut(log.$id, e)}
                                            class="px-3 py-1 bg-purple-600 text-white text-sm rounded hover:bg-purple-700 transition"
                                        >
                                            Mark as Checked Out
                                        </button>
                                    {/if}
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
                class="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
            >
                Previous
            </button>
            <span class="text-sm text-gray-700">
                Page <span class="font-semibold">{currentPage}</span> of <span class="font-semibold">{totalPages}</span>
            </span>
            <button
                on:click={() => currentPage = Math.min(totalPages, currentPage + 1)}
                disabled={currentPage === totalPages || filteredLogs.length === 0}
                class="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
            >
                Next
            </button>
        </div>
    {/if}
</div>

<!-- Modal (same as before) -->
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
                    {#if selectedVisitor.selfieFileId}
                        {#if getSelfieUrl(selectedVisitor.selfieFileId)}
                            <div class="flex justify-center mb-4">
                                <img 
                                    src={getSelfieUrl(selectedVisitor.selfieFileId)} 
                                    alt={selectedVisitor.visitorName} 
                                    class="w-32 h-32 rounded-lg object-cover shadow-md" 
                                />
                            </div>
                        {:else}
                            <div class="flex justify-center mb-4">
                                <div class="w-32 h-32 rounded-lg bg-gray-300 flex items-center justify-center text-white text-4xl font-semibold">
                                    {selectedVisitor.visitorName.charAt(0)}
                                </div>
                            </div>
                        {/if}
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
                    <div>
                        <p class="text-sm font-semibold text-gray-600">Pass Date</p>
                        <p class="text-gray-900">{selectedVisitor.passDate || '-'}</p>
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