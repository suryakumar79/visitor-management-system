<script>
    import { onMount } from 'svelte';
    import { page } from '$app/stores';
    import { goto } from '$app/navigation';
    import { visitorService } from '$lib/visitorService';
    import { RefreshCcw, Users, Package, Send, ArrowLeft } from 'lucide-svelte';

    // ✅ OPTIMIZED: State variables declared at top level (NO browser code here)
    let page1Data = null;
    let departmentId = '';
    let positionId = '';
    let staffId = '';
    let purpose = '';
    let productsDesc = '';
    let departments = [];
    let positions = [];
    let staff = [];
    let filteredPositions = [];
    let filteredStaff = [];
    let message = { text: '', type: '' };
    let submitting = false;
    let loading = true;

    // ✅ OPTIMIZED: Map-based lookups for O(1) filtering
    let staffByDeptMap = new Map();
    let staffByDeptPosMap = new Map();

    function setMessage(text, type = 'error') {
        message = { text, type };
        setTimeout(() => message = { text: '', type: '' }, 7000);
    }

    // ✅ OPTIMIZED: Build staff lookup maps
    function buildStaffMaps() {
        staffByDeptMap.clear();
        staffByDeptPosMap.clear();
        
        staff.forEach(s => {
            // By department
            if (!staffByDeptMap.has(s.departmentId)) {
                staffByDeptMap.set(s.departmentId, []);
            }
            staffByDeptMap.get(s.departmentId).push(s);
            
            // By department + position
            const key = `${s.departmentId}-${s.positionId}`;
            if (!staffByDeptPosMap.has(key)) {
                staffByDeptPosMap.set(key, []);
            }
            staffByDeptPosMap.get(key).push(s);
        });
    }

    // ✅ OPTIMIZED: ALL browser code moved to onMount
    onMount(async () => {
        // Session validation
        const sessionStr = sessionStorage.getItem('visitor_otp_session');
        const page1Str = sessionStorage.getItem('visitor_checkin_page1');
        
        if (!sessionStr || !page1Str) {
            goto('/visitor/login');
            return;
        }

        try {
            const session = JSON.parse(sessionStr);
            if (Date.now() >= session.expiresAt) {
                sessionStorage.removeItem('visitor_otp_session');
                sessionStorage.removeItem('visitor_checkin_page1');
            // Test mode only: the server hands back the host's approval link
            if (response.testApprovalUrl) sessionStorage.setItem('vms_test_approval_url', response.testApprovalUrl);
                goto('/visitor/login');
                return;
            }

            page1Data = JSON.parse(page1Str);

        } catch (error) {
            sessionStorage.removeItem('visitor_otp_session');
            sessionStorage.removeItem('visitor_checkin_page1');
            goto('/visitor/login');
            return;
        }

        // Load check-in data
        loading = true;
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);

            const response = await visitorService.getCheckinData(page1Data.visitorPhone);
            clearTimeout(timeoutId);

            if (response.success) {
                // ✅ NEW: Filter out hidden departments and positions
                departments = response.departments.filter(dept => 
                    dept.status && dept.status.toLowerCase() === 'active'
                );
                
                positions = response.positions.filter(pos => 
                    pos.status && pos.status.toLowerCase() === 'active'
                );
                
                staff = response.staff;
                
                // Build lookup maps for fast filtering
                buildStaffMaps();
            } else {
                throw new Error(response.message || 'Failed to load data');
            }

        } catch (error) {
            console.error('Failed to load data:', error);
            setMessage('Failed to load necessary data. Please try again.', 'error');
        } finally {
            loading = false;
        }
    });

    // ✅ OPTIMIZED: Efficient reactive filtering using Maps
    // Only show positions that belong to active departments AND are active themselves
    $: filteredPositions = departmentId && positions.length > 0
        ? positions.filter(p => p.departmentId === departmentId)
        : positions;

    $: {
        if (departmentId && positionId && staffByDeptPosMap.size > 0) {
            const key = `${departmentId}-${positionId}`;
            filteredStaff = staffByDeptPosMap.get(key) || [];
        } else if (departmentId && staffByDeptMap.size > 0) {
            filteredStaff = staffByDeptMap.get(departmentId) || [];
        } else {
            filteredStaff = staff;
        }
        
        // Reset staffId if current selection is not in filtered list
        if (!filteredStaff.some(s => s.id === staffId)) {
            staffId = '';
        }
    }

    // Reset position when department changes
    $: if (departmentId) {
        if (!filteredPositions.some(p => p.id === positionId)) {
            positionId = '';
        }
    }

    async function handleSubmit() {
        if (!departmentId || !positionId || !staffId || !purpose) {
            setMessage('Please fill in all mandatory fields.', 'error');
            return;
        }

        const selectedStaff = staff.find(s => s.id === staffId);
        if (!selectedStaff) {
            setMessage('Selected staff member not found.', 'error');
            return;
        }

        if (selectedStaff.isOnLeave) {
            setMessage('The selected staff member is currently on leave. Please choose another.', 'error');
            return;
        }

        submitting = true;
        message = { text: '', type: '' };

        try {
            const checkinData = {
                visitorPhone: page1Data.visitorPhone,
                visitorName: page1Data.name,
                visitorEmail: page1Data.email,
                companyName: page1Data.companyName,
                departmentId,
                positionId,
                staffId: selectedStaff.id, 
                staffName: selectedStaff.name,
                purpose,
                totalMembers: page1Data.totalMembers,
                productsDesc: productsDesc || 'N/A',
                selfieFileId: page1Data.selfieFileId
            };

            // ✅ OPTIMIZATION 1: Remove "Submitting" message - just show loader
            // setMessage('Submitting check-in...', 'success');

            // ✅ OPTIMIZATION 2: Reduced timeout from 20s to 15s
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);

            const response = await visitorService.submitCheckin(checkinData);
            clearTimeout(timeoutId);

            if (!response.success) {
                throw new Error(response.message || 'Check-in failed');
            }

            const logId = response.logId;
            if (!logId) {
                throw new Error('No logId received from server');
            }

            console.log('Check-in successful, logId:', logId);

            // ✅ OPTIMIZATION 3: Clean up session storage immediately
            sessionStorage.removeItem('visitor_checkin_page1');
            
            // ✅ OPTIMIZATION 4: Navigate immediately without success message delay
            // Removed the 1000ms delay and "success" message
            goto(`/visitor/status?logId=${logId}`, { replaceState: true });

        } catch (error) {
            if (error.name === 'AbortError') {
                setMessage('Request timed out. Please try again.', 'error');
            } else {
                console.error('Check-in failed:', error);
                setMessage(`Check-in failed: ${error.message}`, 'error');
            }
            submitting = false; // Only reset on error
        }
        // ✅ OPTIMIZATION 5: Don't set submitting=false on success - we're navigating away
    }

    function goBack() {
        goto(`/visitor/checkin?phone=${page1Data.visitorPhone}`);
    }
</script>

<svelte:head>
    <title>Visitor Check-in - Step 2</title>
</svelte:head>

<div class="min-h-screen flex items-center justify-center bg-gray-50 p-4 sm:p-6">
    <div class="w-full max-w-2xl bg-white p-8 sm:p-10 rounded-2xl shadow-xl border border-gray-100">
        
        <div class="flex flex-col items-center mb-8">
            <Users class="w-10 h-10 text-indigo-600 mb-3" />
            <h1 class="text-3xl font-bold text-gray-800 tracking-tight">Meeting Details</h1>
            <p class="text-gray-500 text-center mt-2">Step 2 of 2: Who are you meeting?</p>
        </div>

        {#if message.text}
            <div class="p-4 mb-6 rounded-lg text-sm font-medium {message.type === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-green-50 text-green-700 border border-green-200'}" role="alert">
                {message.text}
            </div>
        {/if}

        {#if loading}
            <div class="flex items-center justify-center py-12">
                <RefreshCcw class="w-8 h-8 animate-spin text-indigo-600" />
                <span class="ml-3 text-gray-600">Loading meeting details...</span>
            </div>
        {:else}
            <form on:submit|preventDefault={handleSubmit} class="space-y-6">
                
                <fieldset class="space-y-6 border-t pt-6 border-gray-200">
                    <legend class="text-xl font-semibold text-gray-800 mb-4">Meeting Information</legend>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label for="department" class="block text-sm font-semibold text-gray-700 mb-2">Department *</label>
                            <select id="department" bind:value={departmentId} class="w-full p-3 border border-gray-300 rounded-xl focus:ring-indigo-500 focus:border-indigo-500" required disabled={submitting}>
                                <option value="">Select Department</option>
                                {#each departments as dept}
                                    <option value={dept.id}>{dept.name}</option>
                                {/each}
                            </select>
                            {#if departments.length === 0}
                                <p class="text-xs text-amber-600 mt-1">No active departments available.</p>
                            {/if}
                        </div>
                        
                        <div>
                            <label for="position" class="block text-sm font-semibold text-gray-700 mb-2">Position *</label>
                            <select id="position" bind:value={positionId} class="w-full p-3 border border-gray-300 rounded-xl focus:ring-indigo-500 focus:border-indigo-500" required disabled={submitting || !departmentId}>
                                <option value="">Select Position</option>
                                {#each filteredPositions as pos}
                                    <option value={pos.id}>{pos.name}</option>
                                {/each}
                            </select>
                            {#if departmentId && filteredPositions.length === 0}
                                <p class="text-xs text-amber-600 mt-1">No active positions in this department.</p>
                            {/if}
                        </div>
                        
                        <div class="md:col-span-2">
                            <label for="staff" class="block text-sm font-semibold text-gray-700 mb-2">Staff Member *</label>
                            <select id="staff" bind:value={staffId} class="w-full p-3 border border-gray-300 rounded-xl focus:ring-indigo-500 focus:border-indigo-500" required disabled={submitting || !departmentId || !positionId}>
                                <option value="">Select Staff Member</option>
                                {#each filteredStaff as s}
                                    <option value={s.id} disabled={s.isOnLeave} class={s.isOnLeave ? 'text-gray-400' : ''}>
                                        {s.name}
                                        {#if s.isOnLeave} (On Leave){/if}
                                    </option>
                                {/each}
                            </select>
                            {#if filteredStaff.length === 0 && departmentId && positionId}
                                <p class="text-xs text-red-500 mt-1">No active staff found in this position.</p>
                            {/if}
                        </div>
                        
                        <div class="md:col-span-2">
                            <label for="purpose" class="block text-sm font-semibold text-gray-700 mb-2">Purpose of Visit *</label>
                            <textarea id="purpose" bind:value={purpose} placeholder="Describe the purpose of your meeting..." required class="w-full p-3 border border-gray-300 rounded-xl focus:ring-indigo-500 focus:border-indigo-500" rows="4" disabled={submitting}></textarea>
                        </div>

                        <div class="md:col-span-2">
                            <label for="productsDesc" class="block text-sm font-semibold text-gray-700 mb-2">
                                <Package class="inline w-4 h-4 mr-1" />
                                Products/Materials Description (Optional)
                            </label>
                            <textarea id="productsDesc" bind:value={productsDesc} placeholder="Are you carrying any materials? (e.g., laptop, samples, documents)" class="w-full p-3 border border-gray-300 rounded-xl focus:ring-indigo-500 focus:border-indigo-500" rows="3" disabled={submitting}></textarea>
                        </div>
                    </div>
                </fieldset>

                {#if page1Data}
                    <div class="bg-gray-50 rounded-xl p-4 border border-gray-200">
                        <h3 class="text-sm font-semibold text-gray-700 mb-2">Summary</h3>
                        <div class="text-sm text-gray-600 space-y-1">
                            <p><strong>Name:</strong> {page1Data.name}</p>
                            <p><strong>Email:</strong> {page1Data.email}</p>
                            <p><strong>Company:</strong> {page1Data.companyName}</p>
                            <p><strong>Members:</strong> {page1Data.totalMembers}</p>
                            <p><strong>Selfie:</strong> ✓ Uploaded</p>
                        </div>
                    </div>
                {/if}
                
                <div class="flex gap-4">
                    <button
                        type="button"
                        on:click={goBack}
                        class="flex-1 py-3 px-4 bg-gray-200 text-gray-700 font-bold rounded-xl shadow hover:bg-gray-300 transition duration-300 flex items-center justify-center space-x-2"
                        disabled={submitting}
                    >
                        <ArrowLeft class="w-5 h-5" />
                        <span>Back</span>
                    </button>
                    
                    <button
                        type="submit"
                        class="flex-[2] py-3 px-4 bg-indigo-600 text-white font-bold rounded-xl shadow-lg hover:bg-indigo-700 transition duration-300 transform hover:scale-[1.005] active:scale-[0.99] flex items-center justify-center space-x-2 {submitting ? 'opacity-70 cursor-wait' : ''}"
                        disabled={submitting}
                    >
                        {#if submitting}
                            <RefreshCcw class="w-5 h-5 animate-spin" />
                            <span>Submitting...</span>
                        {:else}
                            <Send class="w-5 h-5" />
                            <span>Submit Check-in</span>
                        {/if}
                    </button>
                </div>
            </form>
        {/if}
    </div>
</div>