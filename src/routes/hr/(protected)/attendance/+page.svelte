<script>
    import { onMount, tick } from 'svelte';
    import { 
        RefreshCw, XCircle, FileUp, Calendar, Filter, AlertTriangle, CheckCircle, ChevronLeft, ChevronRight, UserCog, Briefcase, Trash2, Download
    } from 'lucide-svelte';
    import * as XLSX from 'xlsx';

    // --- DATA CLIENT ---
    import { 
        databases, 
        Query, 
        VMS_DATABASE_ID, 
        DEPARTMENTS_COLLECTION_ID,
        POSITIONS_COLLECTION_ID,
        STAFF_COLLECTION_ID,
        ATTENDANCE_COLLECTION_ID,
    } from '$lib/client'; 

    // --- CRITICAL CONFIGURATION MAPPING ---    
    const STAFF_PER_PAGE = 30;

    // --- State Management ---
    let allStaff = [];
    let departments = [];
    let positions = [];
    
    // Create lookup maps for O(1) access instead of .find()
    let departmentMap = new Map();
    let positionMap = new Map();
    
    let departmentsLoaded = false; 
    let positionsLoaded = false;
    let isLoading = true;
    let isSubmitting = false;
    let message = { text: '', type: '' };

    // --- Relieve Staff State ---
    let showReliefModal = false;
    let staffToRelieve = null;

    // --- Filter State ---
    let filters = {
        employeeCode: '',
        name: '',
        departmentId: '', 
        position: '', 
        status: '',
    };
    
    // Date for which attendance is being viewed/modified (defaults to today)
    let attendanceDate = new Date().toISOString().substring(0, 10);
    let today = new Date().toISOString().substring(0, 10);

    // --- Optimized Computed Filtered Staff with debouncing ---
    let filteredStaff = [];
    let filterTimeout;
    
    // Debounce filter updates to avoid excessive re-computation
    function updateFilters() {
        clearTimeout(filterTimeout);
        filterTimeout = setTimeout(() => {
            filteredStaff = computeFilteredStaff();
            currentPage = 1; // Reset to first page on filter change
        }, 150);
    }
    
    function computeFilteredStaff() {
        const { employeeCode, name, departmentId, position, status } = filters;
        
        // Early return if no filters
        if (!employeeCode && !name && !departmentId && !position && !status) {
            return allStaff;
        }
        
        const lowerCode = employeeCode.toLowerCase();
        const lowerName = name.toLowerCase();
        const lowerPos = position.toLowerCase();
        const lowerStatus = status.toLowerCase();
        
        return allStaff.filter(staff => {
            if (employeeCode && !staff.employeeCode.toLowerCase().includes(lowerCode)) return false;
            if (name && !staff.name.toLowerCase().includes(lowerName)) return false;
            if (departmentId && staff.departmentId !== departmentId) return false;
            if (position && staff.position.toLowerCase() !== lowerPos) return false;
            if (status && staff.status.toLowerCase() !== lowerStatus) return false;
            return true;
        });
    }

    // Watch filters with debouncing
    $: if (filters) updateFilters();
    
    // --- Pagination State ---
    let currentPage = 1;
    let totalStaffCount = 0;
    let paginatedStaff = [];
    
    // Optimize pagination to only slice when needed
    $: paginatedStaff = filteredStaff.slice(
        (currentPage - 1) * STAFF_PER_PAGE, 
        currentPage * STAFF_PER_PAGE
    );

    // Memoize unique positions with caching
    let cachedPositions = [];
    let lastDeptFilter = '';
    
    $: {
        // Only recompute if department filter changed
        if (filters.departmentId !== lastDeptFilter) {
            lastDeptFilter = filters.departmentId;
            const positionsSet = new Set();
            
            for (const staff of allStaff) {
                if ((!filters.departmentId || staff.departmentId === filters.departmentId) && staff.position) {
                    positionsSet.add(staff.position);
                }
            }
            
            cachedPositions = Array.from(positionsSet);
        }
    }
    
    // --- Utility Functions ---

    function setMessage(text, type = 'error') {
        message = { text, type };
        setTimeout(() => message = { text: '', type: '' }, 7000);
    }

    // Use lookup maps instead of .find() - O(1) vs O(n)
    function getDepartmentName(id) {
        return departmentMap.get(id) || 'Unknown Department';
    }

    function getPositionName(id) {
        return positionMap.get(id) || id || 'Unknown Position';
    }
    
    function changePage(delta) {
        const newPage = currentPage + delta;
        const totalPages = Math.ceil(filteredStaff.length / STAFF_PER_PAGE);
        if (newPage >= 1 && newPage <= totalPages) {
            currentPage = newPage;
        }
    }

    // --- Data Fetching ---

    async function loadDepartments() {
        try {
            const res = await databases.listDocuments(
                VMS_DATABASE_ID,
                DEPARTMENTS_COLLECTION_ID,
                [Query.limit(100)]
            );
            departments = res.documents;
            
            // Build lookup map for O(1) access
            departmentMap = new Map(departments.map(d => [d.$id, d.name]));
            
            departmentsLoaded = true;
            return true;
        } catch (e) {
            console.error("Failed to load departments:", e);
            setMessage('Failed to load departments.', 'error');
            return false;
        }
    }

    async function loadPositions() {
        try {
            const res = await databases.listDocuments(
                VMS_DATABASE_ID,
                POSITIONS_COLLECTION_ID,
                [Query.limit(100)]
            );
            positions = res.documents;
            
            // Build lookup map for O(1) access
            positionMap = new Map(positions.map(p => [p.$id, p.name]));
            
            positionsLoaded = true;
            return true;
        } catch (e) {
            console.error("Failed to load positions:", e);
            setMessage('Failed to load positions.', 'error');
            return false;
        }
    }

    async function fetchStaffAndAttendance() {
        if (!departmentsLoaded || !positionsLoaded) return;
        
        isLoading = true;
        
        try {
            // Fetch both staff and attendance in parallel for better performance
            const [staffRes, attendanceRes] = await Promise.all([
                databases.listDocuments(
                    VMS_DATABASE_ID,
                    STAFF_COLLECTION_ID,
                    [Query.limit(1000), Query.equal('status', 'active')]
                ),
                databases.listDocuments(
                    VMS_DATABASE_ID,
                    ATTENDANCE_COLLECTION_ID,
                    [Query.equal('attendanceDate', attendanceDate), Query.limit(1000)]
                )
            ]);
            
            totalStaffCount = staffRes.total;
            
            // Build attendance map for O(1) lookup
            const attendanceMap = new Map(
                attendanceRes.documents.map(doc => [
                    doc.employeeCode, 
                    { status: doc.status, docId: doc.$id }
                ])
            );
            
            // Map staff data with optimized lookups
            allStaff = staffRes.documents.map(doc => {
                const attendanceRecord = attendanceMap.get(String(doc.employeeCode));
                
                return {
                    id: doc.$id,
                    employeeCode: String(doc.employeeCode), 
                    name: doc.name,
                    departmentId: doc.departmentId, 
                    departmentName: departmentMap.get(doc.departmentId) || 'Unknown',
                    position: positionMap.get(doc.positionId) || 'Unknown',
                    status: attendanceRecord?.status || 'Present',
                    attendanceDocId: attendanceRecord?.docId || null
                };
            });
            
            // Trigger filter recalculation
            updateFilters();
            
            setMessage(`Staff data loaded (${totalStaffCount}). Attendance loaded for ${attendanceDate}.`, 'success');

        } catch (e) {
            console.error("Failed to fetch staff/attendance:", e);
            setMessage('Failed to load data. Ensure "status" index exists in Staff Collection.', 'error');
        } finally {
            isLoading = false;
        }
    }

    // --- Actions: Relieve Staff ---

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
        isSubmitting = true;
        
        try {
            await databases.updateDocument(
                VMS_DATABASE_ID,
                STAFF_COLLECTION_ID,
                staffToRelieve.id,
                { status: 'exstaff' }
            );

            setMessage(`Staff member ${staffToRelieve.name} marked as Ex-Staff.`, 'success');
            cancelRelieve();
            
            await fetchStaffAndAttendance();
        } catch (error) {
            console.error('Staff relief failed:', error);
            setMessage('Failed to update staff status.', 'error');
        } finally {
            isSubmitting = false;
        }
    }

    // --- Actions: Attendance ---

    async function updateAttendanceStatus(staff, newStatus) {
        isSubmitting = true;
        try {
            const documentData = {
                employeeCode: staff.employeeCode,
                status: newStatus,
                attendanceDate: attendanceDate,
            };

            let docIdToUpdate = staff.attendanceDocId;

            if (docIdToUpdate) {
                await databases.updateDocument(
                    VMS_DATABASE_ID,
                    ATTENDANCE_COLLECTION_ID,
                    docIdToUpdate,
                    documentData
                );
            } else {
                const result = await databases.createDocument(
                    VMS_DATABASE_ID,
                    ATTENDANCE_COLLECTION_ID,
                    'unique()',
                    documentData
                );
                
                // Update the staff member's attendance doc ID
                staff.attendanceDocId = result.$id;
            }
            
            // Optimized update - only modify the specific staff member
            staff.status = newStatus;
            allStaff = allStaff; // Trigger reactivity
            updateFilters();

            setMessage(`${staff.name}'s attendance updated to ${newStatus}.`, 'success');

        } catch (e) {
            console.error("Error updating attendance:", e);
            setMessage(`Failed to update attendance. Check database permissions.`, 'error');
        } finally {
            isSubmitting = false;
        }
    }

    function handleToggle(staff) {
        if (attendanceDate !== today) {
            setMessage('Cannot change attendance for past dates. Use Excel upload.', 'error');
            return;
        }

        const newStatus = staff.status === 'Present' ? 'Absent' : 'Present';
        
        showConfirmationModal({
            title: 'Confirm Attendance Change',
            message: `Mark ${staff.name} as ${newStatus} for today?`,
            onConfirm: () => updateAttendanceStatus(staff, newStatus)
        });
    }

    // --- Sample Excel Download ---
    function downloadSampleExcel() {
        try {
            const workbook = XLSX.utils.book_new();
            
            const sampleData = [
                ['', '', '', '', '', '', '', '', ''],
                ['', '', '', '', '', '', '', '', ''],
                ['', '', '', '', '', '', '', '', ''],
                ['', '', '', '', '', '', '', '', ''],
                ['', '', '', '', '', '', '', '', ''],
                ['', '', '', '', '', '', '', '', ''],
                ['', '', '', '', 'DATE:', '2025-01-19', '', '', ''],
                ['', '', '', '', '', '', '', '', ''],
                ['', '', '', '', '', '', '', '', ''],
                ['S.No', 'E. Code', 'Name', 'Department', 'Status', 'InTime', 'OutTime', 'Work Dur.', 'OT'],
                ['1', '101', 'Sample Employee 1', 'IT Department', 'Present', '09:00', '18:00', '09:00', '00:00'],
                ['2', '102', 'Sample Employee 2', 'HR Department', 'Absent', 'N/A', 'N/A', 'N/A', 'N/A'],
                ['3', '103', 'Sample Employee 3', 'Finance', 'Present', '08:30', '17:30', '09:00', '00:00'],
            ];
            
            const worksheet = XLSX.utils.aoa_to_sheet(sampleData);
            
            worksheet['!cols'] = [
                { wch: 6 }, { wch: 10 }, { wch: 25 }, { wch: 20 }, { wch: 10 },
                { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 8 }
            ];
            
            XLSX.utils.book_append_sheet(workbook, worksheet, 'Attendance');
            XLSX.writeFile(workbook, `Attendance_Sample_Format_${today}.xlsx`);
            
            setMessage('Sample Excel format downloaded successfully!', 'success');
        } catch (error) {
            console.error('Error generating sample Excel:', error);
            setMessage('Failed to generate sample Excel file.', 'error');
        }
    }

    // --- Excel Upload Handler ---

    function excelSerialToDate(serial) {
        const excelEpoch = new Date(Date.UTC(1899, 11, 30));
        const msPerDay = 24 * 60 * 60 * 1000;
        const targetMs = excelEpoch.getTime() + (serial * msPerDay);
        const date = new Date(targetMs);
        const year = date.getUTCFullYear();
        const month = String(date.getUTCMonth() + 1).padStart(2, '0');
        const day = String(date.getUTCDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
    
    function excelSerialToTime(serial) {
        if (typeof serial === 'string' && serial.includes(':')) return serial;
        if (typeof serial !== 'number' || serial === 0) return 'N/A';
        const totalSeconds = Math.round(serial * 24 * 60 * 60);
        const hours = Math.floor(totalSeconds / 3600) % 24;
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    }

    async function handleFileUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        isSubmitting = true;
        setMessage('Parsing file...', 'success');

        try {
            const data = await file.arrayBuffer();
            const workbook = XLSX.read(data, { type: 'array' });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            
            const dateCell = worksheet['E7'];
            if (!dateCell || typeof dateCell.v !== 'number') throw new Error("Date cell E7 invalid.");
            const uploadDate = excelSerialToDate(dateCell.v);
            
            const range = XLSX.utils.decode_range(worksheet['!ref']);
            range.s.r = 9; 
            const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 10, range: range, defval: null });
            
            const attendanceUpdates = [];
            
            for (const row of rawData) {
                if (!row['E. Code'] || !row.Status) continue;
                
                let status;
                const statusStr = String(row.Status).toLowerCase();
                if (statusStr.includes('present')) status = 'Present';
                else if (statusStr.includes('absent')) status = 'Absent';
                else continue;

                attendanceUpdates.push({
                    employeeCode: String(row['E. Code']).split('.')[0], 
                    status: status,
                    attendanceDate: uploadDate,
                    inTime: excelSerialToTime(row.InTime),
                    outTime: row.OutTime ? excelSerialToTime(row.OutTime) : 'N/A',
                    workDuration: row['Work Dur.'] || 'N/A',
                });
            }

            if (attendanceUpdates.length === 0) throw new Error("No valid data found.");

            // Fetch existing records
            const existingRecords = await databases.listDocuments(
                VMS_DATABASE_ID,
                ATTENDANCE_COLLECTION_ID,
                [Query.equal('attendanceDate', uploadDate), Query.limit(1000)]
            );
            
            const existingMap = new Map(
                existingRecords.documents.map(doc => [doc.employeeCode, doc.$id])
            );
            
            // Batch updates with Promise.allSettled for better error handling
            const updatePromises = attendanceUpdates.map(update => {
                const docId = existingMap.get(update.employeeCode);
                
                return docId
                    ? databases.updateDocument(VMS_DATABASE_ID, ATTENDANCE_COLLECTION_ID, docId, update)
                    : databases.createDocument(VMS_DATABASE_ID, ATTENDANCE_COLLECTION_ID, 'unique()', update);
            });
            
            const results = await Promise.allSettled(updatePromises);
            const successCount = results.filter(r => r.status === 'fulfilled').length;

            setMessage(`Updated ${successCount} records for ${uploadDate}.`, 'success');
            
            if (uploadDate === attendanceDate) {
                await fetchStaffAndAttendance();
            }

        } catch (e) {
            console.error("Excel Error:", e);
            setMessage(`File error: ${e.message}`, 'error');
        } finally {
            isSubmitting = false;
            event.target.value = null; 
        }
    }

    // --- Modal ---
    let modal = { title: '', message: '', onConfirm: () => {} };
    let isModalOpen = false;

    function showConfirmationModal({ title, message, onConfirm }) {
        modal = { title, message, onConfirm };
        isModalOpen = true;
    }

    function handleModalConfirm() {
        modal.onConfirm();
        isModalOpen = false;
    }

    // --- Init ---
    $: if (attendanceDate && departmentsLoaded && positionsLoaded) fetchStaffAndAttendance();
    $: if (filters.departmentId) filters.position = '';

    onMount(async () => {
        // Load departments and positions in parallel
        const [departmentsSuccess, positionsSuccess] = await Promise.all([
            loadDepartments(),
            loadPositions()
        ]);
        
        if (departmentsSuccess && positionsSuccess) {
            await fetchStaffAndAttendance();
        }
    });
    
    // Cleanup
    onMount(() => {
        return () => {
            clearTimeout(filterTimeout);
        };
    });
</script>

<svelte:head>
    <title>Attendance Management</title>
</svelte:head>

<div class="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
    <header class="mb-8">
        <h1 class="text-4xl font-extrabold text-gray-900 mb-2">Daily Attendance</h1>
        <p class="text-gray-500">View/Update attendance for active staff. Total: {totalStaffCount}</p>
    </header>

    {#if message.text}
        <div class="p-4 mb-6 rounded-xl text-sm font-medium {message.type === 'error' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-green-50 text-green-700 border-green-200'} flex items-center" role="alert">
            {#if message.type === 'error'} <XCircle class="w-5 h-5 mr-2" /> {/if}
            {#if message.type === 'success'} <CheckCircle class="w-5 h-5 mr-2" /> {/if}
            <span>{message.text}</span>
        </div>
    {/if}

    <!-- Controls -->
    <div class="bg-white p-6 rounded-2xl shadow-xl mb-8 flex flex-col md:flex-row gap-4 justify-between items-center">
        <div class="flex items-center space-x-3 w-full md:w-auto">
            <Calendar class="w-5 h-5 text-indigo-600" />
            <label for="attendanceDate" class="font-semibold text-gray-700 whitespace-nowrap">Date:</label>
            <input type="date" id="attendanceDate" bind:value={attendanceDate} class="p-2 border border-gray-300 rounded-xl focus:ring-indigo-500 focus:border-indigo-500" />
        </div>
        <div class="flex gap-3 w-full md:w-auto">
            <button 
                on:click={downloadSampleExcel}
                class="px-6 py-2 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition flex items-center justify-center"
            >
                <Download class="w-5 h-5 mr-2" /> Download Sample
            </button>
            <label for="excel-upload" class="px-6 py-2 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 transition cursor-pointer flex items-center justify-center disabled:opacity-50">
                <FileUp class="w-5 h-5 mr-2" /> {isSubmitting ? 'Processing...' : 'Upload Excel'}
            </label>
            <input type="file" id="excel-upload" accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" on:change={handleFileUpload} disabled={isSubmitting} class="hidden" />
        </div>
    </div>

    <!-- Filters -->
    <div class="bg-white p-6 rounded-2xl shadow-xl mb-8">
        <div class="flex items-center mb-4 border-b pb-2"><Filter class="w-5 h-5 mr-2 text-gray-700" /><h2 class="text-xl font-bold text-gray-800">Filters</h2></div>
        <div class="grid grid-cols-2 md:grid-cols-5 gap-4">
            <input type="text" bind:value={filters.employeeCode} placeholder="E. Code" class="p-3 border border-gray-300 rounded-xl focus:ring-indigo-500" />
            <input type="text" bind:value={filters.name} placeholder="Name" class="p-3 border border-gray-300 rounded-xl focus:ring-indigo-500" />
            
            <div class="flex items-center bg-white border border-gray-300 rounded-xl">
                <UserCog class="w-4 h-4 text-gray-400 ml-3" />
                <select bind:value={filters.departmentId} class="p-3 w-full bg-white focus:ring-indigo-500 border-none rounded-r-xl">
                    <option value="">All Departments</option>
                    {#each departments as dept}<option value={dept.$id}>{dept.name}</option>{/each}
                </select>
            </div>

            <div class="flex items-center bg-white border border-gray-300 rounded-xl">
                <Briefcase class="w-4 h-4 text-gray-400 ml-3" />
                <select bind:value={filters.position} class="p-3 w-full bg-white focus:ring-indigo-500 border-none rounded-r-xl">
                    <option value="">All Positions</option>
                    {#each cachedPositions as position}<option value={position}>{position}</option>{/each}
                </select>
            </div>
            
            <select bind:value={filters.status} class="p-3 border border-gray-300 rounded-xl bg-white focus:ring-indigo-500">
                <option value="">All Statuses</option>
                <option value="Present">Present</option>
                <option value="Absent">Absent</option>
            </select>
        </div>
    </div>

    <!-- List -->
    <div class="bg-white p-6 rounded-2xl shadow-xl overflow-x-auto">
        <div class="flex justify-between items-center mb-4">
            <h2 class="text-xl font-bold text-gray-800">List ({paginatedStaff.length} / {filteredStaff.length})</h2>
            <button on:click={fetchStaffAndAttendance} disabled={isLoading} class="text-indigo-600 hover:text-indigo-800">
                <RefreshCw class="w-5 h-5 {isLoading ? 'animate-spin' : ''}" />
            </button>
        </div>
        
        {#if isLoading}
            <div class="text-center p-10 text-gray-500">Loading data...</div>
        {:else if filteredStaff.length === 0}
            <div class="text-center p-10 text-gray-500">No active staff found matching filters.</div>
        {:else}
            <table class="min-w-full divide-y divide-gray-200">
                <thead class="bg-gray-50">
                    <tr>
                        <th class="px-6 py-3 text-left text-xs font-bold uppercase text-gray-500">E. Code</th>
                        <th class="px-6 py-3 text-left text-xs font-bold uppercase text-gray-500">Name</th>
                        <th class="px-6 py-3 text-left text-xs font-bold uppercase text-gray-500">Dept</th>
                        <th class="px-6 py-3 text-left text-xs font-bold uppercase text-gray-500">Position</th>
                        <th class="px-6 py-3 text-center text-xs font-bold uppercase text-gray-500">Status</th>
                        <th class="px-6 py-3 text-center text-xs font-bold uppercase text-gray-500">Action</th>
                    </tr>
                </thead>
                <tbody class="bg-white divide-y divide-gray-200">
                    {#each paginatedStaff as staff (staff.id)}
                        <tr class="hover:bg-gray-50 transition">
                            <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{staff.employeeCode}</td>
                            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-800">{staff.name}</td>
                            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{staff.departmentName}</td>
                            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{staff.position}</td>
                            <td class="px-6 py-4 whitespace-nowrap text-center">
                                <span class="px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full {staff.status === 'Present' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
                                    {staff.status}
                                </span>
                            </td>
                            <td class="px-6 py-4 whitespace-nowrap text-center space-x-2">
                                <button 
                                    on:click={() => handleToggle(staff)} 
                                    disabled={attendanceDate !== today || isSubmitting}
                                    class="px-3 py-1 text-sm font-medium rounded-xl transition disabled:opacity-50 {staff.status === 'Present' ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-green-500 text-white hover:bg-green-600'}"
                                >
                                    {staff.status === 'Present' ? 'Absent' : 'Present'}
                                </button>
                                <button on:click={() => startRelieve(staff)} class="p-2 bg-gray-100 text-red-600 rounded-full hover:bg-red-100 transition disabled:opacity-50" title="Relieve Staff" disabled={isSubmitting}>
                                    <Trash2 class="w-4 h-4" />
                                </button>
                            </td>
                        </tr>
                    {/each}
                </tbody>
            </table>
            <!-- Pagination -->
            <div class="flex justify-between items-center mt-4 pt-4 border-t">
                <p class="text-sm text-gray-600">Page {currentPage} of {Math.ceil(filteredStaff.length / STAFF_PER_PAGE)}</p>
                <div class="flex space-x-2">
                    <button on:click={() => changePage(-1)} disabled={currentPage === 1} class="p-2 rounded-xl border border-gray-300 bg-white hover:bg-gray-100 disabled:opacity-50"><ChevronLeft class="w-5 h-5" /></button>
                    <button on:click={() => changePage(1)} disabled={currentPage * STAFF_PER_PAGE >= filteredStaff.length} class="p-2 rounded-xl border border-gray-300 bg-white hover:bg-gray-100 disabled:opacity-50"><ChevronRight class="w-5 h-5" /></button>
                </div>
            </div>
        {/if}
    </div>
</div>

<!-- Attendance Change Modal -->
{#if isModalOpen}
    <div class="fixed inset-0 bg-gray-900 bg-opacity-70 z-50 flex items-center justify-center p-4">
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 relative">
            <div class="flex items-center space-x-3 mb-4">
                <AlertTriangle class="w-8 h-8 text-red-500 flex-shrink-0" />
                <h3 class="text-xl font-bold text-gray-800">{modal.title}</h3>
            </div>
            <p class="text-gray-600 mb-6">{modal.message}</p>
            <div class="flex justify-end space-x-3">
                <button on:click={() => isModalOpen = false} class="px-4 py-2 bg-gray-200 text-gray-800 font-semibold rounded-xl hover:bg-gray-300">Cancel</button>
                <button on:click={handleModalConfirm} class="px-4 py-2 bg-red-600 text-white font-semibold rounded-xl hover:bg-red-700">Confirm</button>
            </div>
        </div>
    </div>
{/if}

<!-- Staff Relieved Confirmation Modal -->
{#if showReliefModal && staffToRelieve}
<div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900 bg-opacity-75 backdrop-blur-sm">
    <div class="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
        <div class="flex items-center justify-center w-12 h-12 mx-auto bg-red-100 rounded-full mb-4">
            <AlertTriangle class="w-6 h-6 text-red-600" />
        </div>
        <h3 class="text-lg font-bold text-center text-gray-900 mb-2">Relieve Staff Member?</h3>
        <p class="text-sm text-center text-gray-500 mb-6">
            Mark <strong>{staffToRelieve.name}</strong> (ID: {staffToRelieve.employeeCode}) as Ex-Staff?<br/>
            Status will change to <span class="font-mono text-red-600 bg-red-50 px-1 rounded">exstaff</span>.
        </p>
        <div class="flex space-x-3">
            <button on:click={cancelRelieve} class="flex-1 px-4 py-2 bg-gray-100 text-gray-700 font-semibold rounded-xl hover:bg-gray-200">Cancel</button>
            <button on:click={relieveStaff} disabled={isSubmitting} class="flex-1 px-4 py-2 bg-red-600 text-white font-semibold rounded-xl hover:bg-red-700 disabled:opacity-50">
                {isSubmitting ? 'Processing...' : 'Confirm Relief'}
            </button>
        </div>
    </div>
</div>
{/if}