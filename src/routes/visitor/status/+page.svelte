<script>
    import { onMount, onDestroy } from 'svelte';
    import { page } from '$app/stores';
    import { goto } from '$app/navigation';
    import {
        client,
        VISITOR_LOGS_COLLECTION_ID,
        VMS_DATABASE_ID
    } from '$lib/client';
    import { visitorService } from '$lib/visitorService';
    import { RefreshCw, CheckCircle, XCircle, Clock, Send, Users, Building, Mail, Phone, User, Package, FileCheck, AlertCircle } from 'lucide-svelte';

    let logId = $page.url.searchParams.get('logId');
    let visitorLog = null;
    let message = { text: '', type: '' };
    let loading = true;
    let unsubscribe;
    let pollingInterval; // ✅ NEW: Polling fallback
    let sessionCleared = false;
    let isPageExpired = false;
    let realtimeConnected = false; // ✅ NEW: Track connection status
    let testApprovalUrl = '';
    try { testApprovalUrl = sessionStorage.getItem('vms_test_approval_url') || ''; } catch { /* private mode */ }

    function setMessage(text, type = 'error') {
        message = { text, type };
        setTimeout(() => message = { text: '', type: '' }, 7000);
    }

    function clearOtpSession() {
        if (!sessionCleared) {
            sessionStorage.removeItem('visitor_otp_session');
            sessionCleared = true;
            console.log('✅ OTP session cleared - user can now access pages via direct links');
        }
    }

    function parseRequestTime(requestTime) {
        if (!requestTime || requestTime === 'N/A' || requestTime === '') {
            return null;
        }

        try {
            const date = new Date(requestTime);
            if (isNaN(date.getTime())) {
                console.log('⚠️ Failed to parse date:', requestTime);
                return null;
            }
            return date;
        } catch (error) {
            console.log('⚠️ Error parsing date:', error);
            return null;
        }
    }

    function checkPageExpiration(passDate, requestTime) {
    // Use passDate if available, fall back to requestTime for old records
		const dateToCheck = passDate || requestTime;

		if (!dateToCheck || dateToCheck === 'N/A' || dateToCheck === '') {
			isPageExpired = false;
			return;
		}

		let checkDay;

		if (passDate && /^\d{4}-\d{2}-\d{2}$/.test(passDate)) {
			// ✅ Parse YYYY-MM-DD locally (no UTC shift)
			const [year, month, day] = passDate.split('-').map(Number);
			checkDay = new Date(year, month - 1, day);
		} else {
			// Fallback: full ISO datetime (approvalTime / requestTime)
			checkDay = parseRequestTime(dateToCheck);
			if (!checkDay || isNaN(checkDay.getTime())) {
				isPageExpired = false;
				return;
			}
		}

		checkDay.setHours(0, 0, 0, 0);

		const today = new Date();
		today.setHours(0, 0, 0, 0);

		if (today.getTime() > checkDay.getTime()) {
			isPageExpired = true;
			setMessage('This visitor pass has expired.', 'error');
		} else if (today.getTime() < checkDay.getTime()) {
			// ✅ Future passDate - status page still accessible, just can't view pass yet
			isPageExpired = false;
		} else {
			isPageExpired = false;
		}
	}

    // ✅ NEW: Refresh visitor log data
    async function refreshVisitorLog() {
        if (!logId || isPageExpired) return;

        try {
            const response = await visitorService.getVisitorLog(logId);

            if (response.success && response.log) {
                const oldStatus = visitorLog?.status;
                visitorLog = response.log;

                // Check for status changes
                if (oldStatus && oldStatus !== visitorLog.status) {
                    console.log(`✅ Status changed: ${oldStatus} → ${visitorLog.status}`);
                    setMessage('Request status updated!', 'success');

                    // Redirect to pass if approved
                    if (visitorLog.status === 'approved') {
                        setTimeout(() => {
                            goto(`/visitor/pass?logId=${logId}`);
                        }, 2000);
                    }
                }

                // Recheck expiration
                checkPageExpiration(visitorLog.passDate, visitorLog.requestTime);
            }
        } catch (error) {
            console.error('❌ Failed to refresh log:', error);
        }
    }

    // ✅ NEW: Start polling fallback
    function startPolling() {
        console.log('🔄 Starting polling fallback (every 5 seconds)');

        // Clear any existing interval
        if (pollingInterval) {
            clearInterval(pollingInterval);
        }

        // Poll every 5 seconds
        pollingInterval = setInterval(async () => {
            if (!isPageExpired) {
                await refreshVisitorLog();
            }
        }, 5000);
    }

    // ✅ IMPROVED: Setup real-time with fallback
    function setupRealtime(logIdToLoad) {
        try {
            const channelName = `databases.${VMS_DATABASE_ID}.collections.${VISITOR_LOGS_COLLECTION_ID}.documents.${logIdToLoad}`;

            console.log('📡 Attempting real-time subscription:', channelName);

            unsubscribe = client.subscribe(
                channelName,
                async (response) => {
                    console.log('📨 Real-time event received:', response);

                    if (response.events.some(e => e.includes('update'))) {
                        realtimeConnected = true;
                        console.log('✅ Real-time update detected');
                        await refreshVisitorLog();
                    }
                }
            );

            console.log('✅ Real-time subscription created');

            // Check if real-time is working after 10 seconds
            setTimeout(() => {
                if (!realtimeConnected) {
                    console.log('⚠️ Real-time not confirmed, enabling polling fallback');
                    startPolling();
                } else {
                    console.log('✅ Real-time is working');
                }
            }, 10000);

        } catch (error) {
            console.error('❌ Real-time subscription failed:', error);
            console.log('🔄 Falling back to polling');
            startPolling();
        }
    }

    async function loadVisitorLog(logIdToLoad) {
        let retries = 5;
        let lastError;

        while (retries > 0) {
            try {
                const response = await visitorService.getVisitorLog(logIdToLoad);

                if (response.success) {
                    visitorLog = response.log;

                    // Check if the page is expired based on the request time
                    checkPageExpiration(visitorLog.requestTime);

                    if (isPageExpired) {
                        return true;
                    }

                    clearOtpSession();

                    if (visitorLog.status === 'approved') {
                        setTimeout(() => {
                            goto(`/visitor/pass?logId=${logIdToLoad}`);
                        }, 1500);
                    }

                    // ✅ IMPROVED: Set up real-time with fallback
                    setupRealtime(logIdToLoad);

                    return true;
                } else {
                    throw new Error(response.message || 'Failed to load log');
                }
            } catch (error) {
                lastError = error;
                retries--;

                if (retries > 0) {
                    await new Promise(resolve => setTimeout(resolve, 1000 * (6 - retries)));
                }
            }
        }

        throw lastError || new Error('Failed to load document after retries');
    }

    onMount(async () => {
        if (logId) {
            console.log('Loading visitor log:', logId);
            await new Promise(resolve => setTimeout(resolve, 1000));

            try {
                await loadVisitorLog(logId);
            } catch (error) {
                console.error('Failed to load visitor log:', error);

                if (error.message?.includes('not found')) {
                    setMessage('Visitor request not found. Please wait and refresh.', 'error');
                } else {
                    setMessage('Failed to retrieve visitor request status. Please refresh.', 'error');
                }
            } finally {
                loading = false;
            }
        } else {
            setMessage('Invalid request: No visitor log ID provided.', 'error');
            loading = false;
        }
    });

    // ✅ IMPROVED: Cleanup both real-time and polling
    onDestroy(() => {
        if (unsubscribe) {
            console.log('🔌 Unsubscribing from real-time');
            unsubscribe();
        }
        if (pollingInterval) {
            console.log('⏹️ Stopping polling');
            clearInterval(pollingInterval);
        }
    });

    function getStatusIcon(status) {
        switch (status) {
            case 'pending': return Clock;
            case 'approved': return CheckCircle;
            case 'checked-in': return CheckCircle;
            case 'partial-checkout': return Send;
            case 'rejected': return XCircle;
            case 'checkedOut': return Send;
            default: return RefreshCw;
        }
    }

    function getStatusMessage(status) {
        switch (status) {
            case 'pending': return 'Your request is being reviewed by the staff member.';
            case 'approved': return 'Your request has been approved! You may proceed to the premises.';
            case 'checked-in': return 'You have checked in successfully. Welcome!';
            case 'rejected': return 'Your request has been declined. Please contact the staff member.';
            case 'checkedOut': return 'You have successfully checked out. Thank you!';
            case 'partial-checkout': return 'Partial checkout in progress.';
            default: return 'Status unknown.';
        }
    }

    function handleBackToLogin() {
        goto('/visitor/login');
    }

    function handleViewPass() {
        if (isPageExpired) {
            setMessage('Cannot view pass. This visitor pass has expired.', 'error');
            return;
        }
        goto(`/visitor/pass?logId=${logId}`);
    }

    function canViewPass(status) {
        if (!status || isPageExpired) return false;
        const normalizedStatus = status.toLowerCase();
        return normalizedStatus === 'approved' ||
               normalizedStatus === 'checked-in' ||
               normalizedStatus === 'partial-checkout';
    }

    function formatDate(requestTime) {
        if (!requestTime || requestTime === 'N/A' || requestTime === '') return 'N/A';

        try {
            const date = new Date(requestTime);
            if (isNaN(date.getTime())) return 'Invalid Date';

            return date.toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });
        } catch (error) {
            console.log('⚠️ Error formatting date:', error);
            return 'Invalid Date';
        }
    }

    // ✅ NEW: Manual refresh button handler
    async function handleManualRefresh() {
        loading = true;
        await refreshVisitorLog();
        loading = false;
        setMessage('Status refreshed', 'success');
    }
</script>

<svelte:head>
    <title>Visitor Request Status</title>
</svelte:head>

<div class="min-h-screen flex items-center justify-center bg-gray-50 p-4 sm:p-6">
    <div class="w-full max-w-2xl bg-white p-8 sm:p-10 rounded-2xl shadow-xl border border-gray-100">

        {#if testApprovalUrl}
            <div class="mb-6 rounded-lg border-2 border-dashed border-amber-400 bg-amber-50 p-3 text-sm" data-testid="test-approval">
                <p class="font-semibold text-amber-800">Test mode – host approval link</p>
                <p class="text-amber-700 mb-1">No e-mail or message is sent in test mode. Open this link as the host to approve or reject:</p>
                <a href={testApprovalUrl} target="_blank" rel="noopener" class="break-all text-indigo-700 underline">{testApprovalUrl}</a>
            </div>
        {/if}

        {#if isPageExpired && !loading}
            <!-- Expired Page View -->
            <div class="flex flex-col items-center">
                <AlertCircle class="w-16 h-16 text-red-600 mb-4" />
                <h1 class="text-3xl font-bold text-gray-800 tracking-tight mb-2">Pass Expired</h1>
                <p class="text-gray-600 text-center max-w-md">
                    This visitor pass is no longer valid. Passes are only accessible on the requested visit date.
                </p>
            </div>
        {:else}
            <!-- ✅ NEW: Real-time status indicator -->
            {#if !loading && visitorLog && visitorLog.status === 'pending'}
                <div class="mb-4 flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg p-3">
                    <div class="flex items-center text-sm text-blue-800">
                        <div class="w-2 h-2 rounded-full {realtimeConnected ? 'bg-green-500' : 'bg-yellow-500'} animate-pulse mr-2"></div>
                        {realtimeConnected ? 'Live updates active' : 'Checking for updates...'}
                    </div>
                    <button
                        on:click={handleManualRefresh}
                        class="text-blue-600 hover:text-blue-700 flex items-center gap-1 text-xs"
                        disabled={loading}
                    >
                        <RefreshCw class="w-3 h-3 {loading ? 'animate-spin' : ''}" />
                        Refresh
                    </button>
                </div>
            {/if}

            <!-- Normal Status View -->
            <div class="flex flex-col items-center mb-8">
                {#if loading}
                    <RefreshCw class="w-12 h-12 text-indigo-600 animate-spin mb-3" />
                    <h1 class="text-3xl font-bold text-gray-800 tracking-tight mb-2">Loading Status...</h1>
                    <p class="text-gray-500">Please wait while we retrieve your request details.</p>
                {:else if !visitorLog}
                    <XCircle class="w-12 h-12 text-red-600 mb-3" />
                    <h1 class="text-3xl font-bold text-gray-800 tracking-tight mb-2">Request Not Found</h1>
                    <p class="text-gray-500">We could not find your visitor request details.</p>
                {:else}
                    <svelte:component
                        this={getStatusIcon(visitorLog.status)}
                        class="w-16 h-16 mb-4 {
                         canViewPass(visitorLog.status) ? 'text-green-600' :
                            visitorLog.status === 'rejected' ? 'text-red-600' :
                            visitorLog.status === 'pending' ? 'text-yellow-600' :
                            'text-blue-600'
                        }"
                    />
                    <h1 class="text-3xl font-bold text-gray-800 tracking-tight mb-2">
                        <span class="text-gray-600">Status:</span>
                        <span class="capitalize {
                            visitorLog.status === 'approved' ? 'text-green-600' :
                            visitorLog.status === 'rejected' ? 'text-red-600' :
                            visitorLog.status === 'pending' ? 'text-yellow-600' :
                            'text-blue-600'
                        }">
                         {#if visitorLog.status === 'checked-in'}
                                Checked In
                            {:else if visitorLog.status === 'partial-checkout'}
                                Partial Checkout
                            {:else}
                                {visitorLog.status}
                            {/if}
                        </span>
                    </h1>
                    <p class="text-gray-600 text-center max-w-md">{getStatusMessage(visitorLog.status)}</p>
                {/if}
            </div>

            {#if message.text}
                <div class="p-4 mb-6 rounded-lg text-sm font-medium {message.type === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-green-50 text-green-700 border border-green-200'}" role="alert">
                    {message.text}
                </div>
            {/if}

            {#if !loading && visitorLog}
                <div class="text-left mt-8 space-y-6">
                    <!-- Visit Date Display -->
                    <div class="bg-indigo-50 p-4 rounded-xl border border-indigo-200">
                        <p class="text-indigo-800 text-sm font-semibold mb-1 flex items-center">
                            <Clock class="w-4 h-4 mr-2" />
                            Requested Visit Date
                        </p>
                        <p class="text-indigo-900 text-lg font-medium">
                            {formatDate(visitorLog.requestTime)}
                        </p>
                    </div>

                    <div class="bg-gray-50 p-6 rounded-xl border border-gray-200">
                        <h2 class="text-xl font-semibold text-gray-800 mb-4 flex items-center">
                            <User class="w-5 h-5 mr-2 text-indigo-600" />
                            Your Details
                        </h2>
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-gray-700">
                            <div class="flex items-start">
                                <User class="w-4 h-4 mr-2 mt-1 text-gray-400 flex-shrink-0" />
                                <div>
                                    <span class="font-medium block text-gray-500 text-xs">Name</span>
                                    {visitorLog.visitorName}
                                </div>
                            </div>
                            <div class="flex items-start">
                                <Mail class="w-4 h-4 mr-2 mt-1 text-gray-400 flex-shrink-0" />
                                <div>
                                    <span class="font-medium block text-gray-500 text-xs">Email</span>
                                    {visitorLog.visitorEmail}
                                </div>
                            </div>
                            <div class="flex items-start">
                                <Phone class="w-4 h-4 mr-2 mt-1 text-gray-400 flex-shrink-0" />
                                <div>
                                    <span class="font-medium block text-gray-500 text-xs">Phone</span>
                                    {visitorLog.visitorPhone}
                                </div>
                            </div>
                            <div class="flex items-start">
                                <Building class="w-4 h-4 mr-2 mt-1 text-gray-400 flex-shrink-0" />
                                <div>
                                    <span class="font-medium block text-gray-500 text-xs">Company</span>
                                    {visitorLog.companyName}
                                </div>
                            </div>
                            <div class="flex items-start">
                                <Users class="w-4 h-4 mr-2 mt-1 text-gray-400 flex-shrink-0" />
                                <div>
                                    <span class="font-medium block text-gray-500 text-xs">Group Size</span>
                                    {visitorLog.totalMembers} {visitorLog.totalMembers > 1 ? 'members' : 'member'}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="bg-indigo-50 p-6 rounded-xl border border-indigo-200">
                        <h2 class="text-xl font-semibold text-gray-800 mb-4 flex items-center">
                            <Clock class="w-5 h-5 mr-2 text-indigo-600" />
                            Meeting Details
                        </h2>
                        <div class="space-y-3 text-gray-700">
                            <div class="flex items-start">
                                <User class="w-4 h-4 mr-2 mt-1 text-gray-400 flex-shrink-0" />
                                <div>
                                    <span class="font-medium block text-gray-500 text-xs">Meeting With</span>
                                    {visitorLog.staffName}
                                </div>
                            </div>
                            <div class="flex items-start">
                                <Clock class="w-4 h-4 mr-2 mt-1 text-gray-400 flex-shrink-0" />
                                <div>
                                    <span class="font-medium block text-gray-500 text-xs">Purpose of Visit</span>
                                    {visitorLog.purpose}
                                </div>
                            </div>
                            {#if visitorLog.productsDesc && visitorLog.productsDesc !== 'N/A'}
                                <div class="flex items-start">
                                    <Package class="w-4 h-4 mr-2 mt-1 text-gray-400 flex-shrink-0" />
                                    <div>
                                        <span class="font-medium block text-gray-500 text-xs">Products Carried</span>
                                        {visitorLog.productsDesc}
                                    </div>
                                </div>
                            {/if}
                        </div>
                    </div>

                    {#if visitorLog.status === 'pending'}
                        <div class="bg-yellow-50 border border-yellow-200 p-4 rounded-lg">
                            <p class="text-yellow-800 text-sm flex items-center">
                                <Clock class="w-4 h-4 mr-2" />
                                <span>Your request is under review. You will be notified by e-mail.</span>
                            </p>
                        </div>
                    {:else if canViewPass(visitorLog.status)}
                        <div class="bg-green-50 border border-green-200 p-4 rounded-lg">
                            <p class="text-green-800 text-sm flex items-center">
                                <CheckCircle class="w-4 h-4 mr-2" />
                                <span>
                                    {#if visitorLog.status.toLowerCase().includes('checked')}
                                        Welcome! You have successfully checked in.
                                    {:else}
                                        Great! You can now proceed to the premises.
                                    {/if}
                                </span>
                            </p>
                        </div>
                        {#if visitorLog.notes}
                            <div class="bg-blue-50 border border-blue-200 p-4 rounded-lg">
                                <p class="text-blue-800 text-xs font-semibold mb-1">📝 Note from Staff:</p>
                                <p class="text-blue-700 text-sm">{visitorLog.notes}</p>
                            </div>
                        {/if}
                    {:else if visitorLog.status === 'rejected'}
                        <div class="bg-red-50 border border-red-200 p-4 rounded-lg">
                            <p class="text-red-800 text-sm flex items-center">
                                <XCircle class="w-4 h-4 mr-2" />
                                <span>Your request was declined. Please contact the staff member.</span>
                            </p>
                        </div>
                        {#if visitorLog.rejectionReason}
                            <div class="bg-red-50 border border-red-200 p-4 rounded-lg mt-3">
                                <p class="text-red-800 text-xs font-semibold mb-1">Rejection Reason:</p>
                                <p class="text-red-700 text-sm">{visitorLog.rejectionReason}</p>
                            </div>
                        {/if}
                    {/if}
                </div>

                <div class="mt-8 flex justify-center gap-3 flex-wrap">
                    {#if canViewPass(visitorLog.status)}
                        <button
                            on:click={handleViewPass}
                            class="px-8 py-3 bg-green-600 text-white font-medium rounded-xl hover:bg-green-700 transition duration-150 shadow-lg flex items-center gap-2"
                        >
                            <FileCheck class="w-5 h-5" />
                            View Pass
                        </button>
                    {/if}
                </div>

                <div class="mt-6 pt-6 border-t border-gray-200 text-gray-500 text-sm text-center">
                    <p>Request ID: <span class="font-mono text-xs">{logId}</span></p>
                    <p class="mt-2">This page updates automatically when your status changes.</p>
                    <p class="mt-1 text-xs text-gray-400">Pass valid until end of: {visitorLog.passDate || 'visit date'}</p>
                </div>
            {:else if !loading && !visitorLog}
                <div class="mt-8 flex justify-center">
                    <button
                        on:click={handleBackToLogin}
                        class="px-6 py-3 bg-indigo-600 text-white font-medium rounded-xl hover:bg-indigo-700 transition duration-150 shadow-lg"
                    >
                        Go to Login
                    </button>
                </div>
            {/if}
        {/if}
    </div>
</div>