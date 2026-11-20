<script>
    import { onMount, onDestroy } from 'svelte';
    import { page } from '$app/stores';
    import { browser } from '$app/environment';
    import { RefreshCw, CheckCircle, XCircle, Clock, User, Users, Building, Mail, Phone, Package, AlertTriangle } from 'lucide-svelte';

    // ✅ OPTIMIZED: Get URL params once
    const logId = $page.url.searchParams.get('logId');
    const requestToken = $page.url.searchParams.get('token');
    
    // State variables
    let visitorLog = null;
    let sessionToken = null;
    let sessionExpiresAt = null;
    let staffEmail = null;
    let sessionsRemaining = null;
    
    let message = { text: '', type: '' };
    let loading = true;
    let submitting = false;
    let approvalNotes = '';
    let rejectionReason = '';
    let showRejectDialog = false;
    let showApproveDialog = false; // ✅ NEW: Custom approve dialog
    let needsLogin = false;
    let isExpired = false;
    let alreadyProcessed = false;
    let sessionLimitReached = false;
    let timeRemaining = '';

    // ✅ OPTIMIZED: Single session timer
    let sessionTimer;

    // Pass Date - defaults to today
    function getTodayString() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`; // Local date, no UTC shift
}
    let passDate = getTodayString();

    // ✅ OPTIMIZED: Cached API call wrapper with timeout
    async function apiCall(action, data, timeoutMs = 15000) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const response = await fetch('/api/visitor-checkin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, ...data }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            const result = await response.json();
            return { statusCode: response.status, data: result };

        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                throw new Error('Request timed out');
            }
            throw error;
        }
    }

    function setMessage(text, type = 'error') {
        message = { text, type };
        setTimeout(() => message = { text: '', type: '' }, 7000);
    }

    // ✅ OPTIMIZED: Efficient time formatting
    function formatTimeRemaining(expiresAt) {
        if (!expiresAt) return '';
        
        const diff = new Date(expiresAt) - Date.now();
        
        if (diff <= 0) return 'Expired';
        
        const minutes = Math.floor(diff / 60000);
        const seconds = Math.floor((diff % 60000) / 1000);
        
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }

    // ✅ OPTIMIZED: Single timer function
    function startSessionTimer() {
        if (sessionTimer) clearInterval(sessionTimer);
        
        sessionTimer = setInterval(() => {
            if (sessionExpiresAt) {
                timeRemaining = formatTimeRemaining(sessionExpiresAt);
                
                if (timeRemaining === 'Expired') {
                    clearInterval(sessionTimer);
                    setMessage('Your session has expired. Please refresh and login again.', 'error');
                    needsLogin = true;
                }
            }
        }, 1000);
    }

    // ✅ OPTIMIZED: Session creation with better error handling
    async function createSession() {
        if (!logId || !requestToken) {
            setMessage('Invalid approval link', 'error');
            return false;
        }

        try {
            const { statusCode, data } = await apiCall('createStaffSession', {
                logId,
                requestToken
            });

            if (statusCode === 200 && data.success) {
                sessionToken = data.sessionToken;
                sessionExpiresAt = data.expiresAt;
                staffEmail = data.staffEmail;
                sessionsRemaining = data.sessionsRemaining;
                visitorLog = data.logData;

                // ✅ OPTIMIZED: Cache session in sessionStorage
                if (browser) {
                    sessionStorage.setItem('staff_approval_session', JSON.stringify({
                        sessionToken,
                        sessionExpiresAt,
                        staffEmail,
                        logId
                    }));
                }

                startSessionTimer();
                
                // Show warning if sessions running low
                if (sessionsRemaining !== null && sessionsRemaining <= 1) {
                    setMessage(`⚠️ Warning: Only ${sessionsRemaining} session${sessionsRemaining !== 1 ? 's' : ''} remaining`, 'info');
                }
                
                return true;

            } else {
                // Handle error cases
                if (data.needsLogin) {
                    needsLogin = true;
                    setMessage(data.message || 'Invalid or expired link', 'error');
                } else if (data.isExpired) {
                    isExpired = true;
                    setMessage(data.message, 'error');
                } else if (data.alreadyProcessed) {
                    alreadyProcessed = true;
                    visitorLog = { status: data.status };
                    setMessage(data.message, 'info');
                } else if (data.sessionLimitReached) {
                    sessionLimitReached = true;
                    needsLogin = true;
                    setMessage(data.message, 'error');
                } else {
                    setMessage(data.message || 'Failed to authenticate', 'error');
                }
                return false;
            }

        } catch (error) {
            console.error('Session creation failed:', error);
            setMessage(error.message || 'Failed to authenticate. Please try again.', 'error');
            return false;
        }
    }

    // ✅ OPTIMIZED: Session validation with early return
    async function validateSession() {
        if (!browser) return false;

        const stored = sessionStorage.getItem('staff_approval_session');
        if (!stored) return false;

        try {
            const session = JSON.parse(stored);
            
            // ✅ OPTIMIZED: Quick expiry check first
            if (Date.now() > new Date(session.sessionExpiresAt).getTime()) {
                sessionStorage.removeItem('staff_approval_session');
                return false;
            }

            const { statusCode, data } = await apiCall('validateStaffSession', {
                sessionToken: session.sessionToken,
                logId
            }, 8000); // Shorter timeout for validation

            if (statusCode === 200 && data.valid) {
                sessionToken = session.sessionToken;
                sessionExpiresAt = session.sessionExpiresAt;
                staffEmail = session.staffEmail;
                visitorLog = data.logData;

                startSessionTimer();
                return true;
            } else {
                sessionStorage.removeItem('staff_approval_session');
                if (data.needsLogin) {
                    needsLogin = true;
                }
                return false;
            }

        } catch (error) {
            console.error('Session validation failed:', error);
            sessionStorage.removeItem('staff_approval_session');
            return false;
        }
    }

    onMount(async () => {
        loading = true;

        // ✅ OPTIMIZED: Try existing session first (faster)
        const hasValidSession = await validateSession();

        if (!hasValidSession) {
            const sessionCreated = await createSession();
            
            if (!sessionCreated) {
                loading = false;
                return;
            }
        }

        loading = false;
    });

    // ✅ OPTIMIZED: Cleanup on destroy
    onDestroy(() => {
        if (sessionTimer) clearInterval(sessionTimer);
    });

    // ✅ NEW: Open approve dialog
    function openApproveDialog() {
        if (!visitorLog || visitorLog.status !== 'pending') {
            setMessage('This request cannot be updated', 'error');
            return;
        }
        showApproveDialog = true;
    }

    // ✅ NEW: Close approve dialog
    function closeApproveDialog() {
        showApproveDialog = false;
    }

    function openRejectDialog() {
        showRejectDialog = true;
        rejectionReason = '';
    }

    function closeRejectDialog() {
        showRejectDialog = false;
        rejectionReason = '';
    }

    // ✅ FIXED: Approval without native confirm()
    async function handleApprove() {
        submitting = true;
        message = { text: '', type: '' };
        closeApproveDialog(); // Close the dialog

        try {
            const { statusCode, data } = await apiCall('updateStatus', {
                sessionToken,
                logId,
                newStatus: 'approved',
                notes: approvalNotes.trim() || null,
                passDate: passDate || getTodayString()
            });

            if (statusCode === 200 && data.success) {
                setMessage('Request approved successfully!', 'success');
                
                // Clear session
                if (browser) {
                    sessionStorage.removeItem('staff_approval_session');
                }
                
                visitorLog = { ...visitorLog, status: 'approved' };
                alreadyProcessed = true;

            } else {
                if (data.needsLogin) {
                    needsLogin = true;
                    setMessage('Session expired. Please refresh the page.', 'error');
                } else {
                    setMessage(data.message || 'Approval failed', 'error');
                }
            }

        } catch (error) {
            console.error('Approval failed:', error);
            setMessage(error.message || 'Approval failed. Please try again.', 'error');
        } finally {
            submitting = false;
        }
    }

    // ✅ OPTIMIZED: Rejection with validation
    async function handleReject() {
        const trimmedReason = rejectionReason.trim();
        
        if (!trimmedReason) {
            setMessage('Please provide a rejection reason', 'error');
            return;
        }

        submitting = true;
        message = { text: '', type: '' };

        try {
            const { statusCode, data } = await apiCall('updateStatus', {
                sessionToken,
                logId,
                newStatus: 'rejected',
                rejectionReason: trimmedReason
            });

            if (statusCode === 200 && data.success) {
                setMessage('Request rejected successfully!', 'success');
                
                // Clear session
                if (browser) {
                    sessionStorage.removeItem('staff_approval_session');
                }
                
                closeRejectDialog();
                visitorLog = { ...visitorLog, status: 'rejected', rejectionReason: trimmedReason };
                alreadyProcessed = true;

            } else {
                if (data.needsLogin) {
                    needsLogin = true;
                    setMessage('Session expired. Please refresh the page.', 'error');
                } else {
                    setMessage(data.message || 'Rejection failed', 'error');
                }
            }

        } catch (error) {
            console.error('Rejection failed:', error);
            setMessage(error.message || 'Rejection failed. Please try again.', 'error');
        } finally {
            submitting = false;
        }
    }

    // ✅ OPTIMIZED: Inline status utilities
    const statusConfig = {
        pending: { class: 'bg-yellow-100 text-yellow-800', icon: Clock },
        approved: { class: 'bg-green-100 text-green-800', icon: CheckCircle },
        rejected: { class: 'bg-red-100 text-red-800', icon: XCircle },
        'checked-in': { class: 'bg-blue-100 text-blue-800', icon: CheckCircle }
    };

    function getStatusClass(status) {
        return statusConfig[status]?.class || 'bg-gray-100 text-gray-800';
    }

    function getStatusIcon(status) {
        return statusConfig[status]?.icon || RefreshCw;
    }
</script>

<svelte:head>
    <title>Visitor Approval - Staff</title>
</svelte:head>

<!-- Loading Overlay -->
{#if submitting}
    <div class="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center p-4 z-50">
        <div class="bg-white rounded-2xl shadow-2xl p-8 max-w-sm w-full text-center">
            <RefreshCw class="w-16 h-16 text-indigo-600 animate-spin mx-auto mb-4" />
            <h3 class="text-xl font-bold text-gray-800 mb-2">Processing...</h3>
            <p class="text-gray-600 text-sm">Please wait</p>
        </div>
    </div>
{/if}

<!-- ✅ NEW: Approval Confirmation Dialog -->
{#if showApproveDialog}
    <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50" on:click={closeApproveDialog}>
        <div class="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6" on:click|stopPropagation>
            <div class="flex items-center mb-4">
                <CheckCircle class="w-8 h-8 text-green-600 mr-3" />
                <h2 class="text-2xl font-bold text-gray-800">Approve Request</h2>
            </div>
            
            <p class="text-gray-600 mb-6">
                Are you sure you want to approve this visitor request?
                {#if approvalNotes.trim()}
                <span class="block mt-2 text-sm">Your notes will be shared with the visitor.</span>
                {/if}
            </p>
            
            <div class="flex justify-end space-x-3">
                <button 
                    on:click={closeApproveDialog}
                    class="px-6 py-2.5 bg-gray-200 text-gray-700 rounded-xl hover:bg-gray-300"
                    disabled={submitting}
                >
                    Cancel
                </button>
                <button 
                    on:click={handleApprove}
                    class="px-6 py-2.5 bg-green-600 text-white rounded-xl hover:bg-green-700 flex items-center gap-2"
                    disabled={submitting}
                >
                    <CheckCircle class="w-4 h-4" />
                    Approve
                </button>
            </div>
        </div>
    </div>
{/if}

<!-- Rejection Dialog -->
{#if showRejectDialog}
    <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50" on:click={closeRejectDialog}>
        <div class="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6" on:click|stopPropagation>
            <div class="flex items-center mb-4">
                <XCircle class="w-8 h-8 text-red-600 mr-3" />
                <h2 class="text-2xl font-bold text-gray-800">Reject Request</h2>
            </div>
            
            <p class="text-gray-600 mb-4">Please provide a reason (will be shared with visitor)</p>
            
            <div class="mb-6">
                <label for="rejectionReason" class="block text-sm font-medium text-gray-700 mb-2">Reason *</label>
                <textarea 
                    id="rejectionReason" 
                    bind:value={rejectionReason} 
                    placeholder="e.g., Meeting cancelled" 
                    class="w-full p-3 border rounded-xl focus:ring-red-500 focus:border-red-500" 
                    rows="4"
                    autofocus
                ></textarea>
            </div>
            
            <div class="flex justify-end space-x-3">
                <button 
                    on:click={closeRejectDialog}
                    class="px-6 py-2.5 bg-gray-200 text-gray-700 rounded-xl hover:bg-gray-300"
                    disabled={submitting}
                >
                    Cancel
                </button>
                <button 
                    on:click={handleReject}
                    class="px-6 py-2.5 bg-red-600 text-white rounded-xl hover:bg-red-700 flex items-center gap-2"
                    disabled={submitting || !rejectionReason.trim()}
                >
                    <XCircle class="w-4 h-4" />
                    Reject
                </button>
            </div>
        </div>
    </div>
{/if}

<div class="min-h-screen flex items-center justify-center bg-gray-50 p-4 sm:p-6">
    <div class="w-full max-w-3xl bg-white p-8 sm:p-10 rounded-2xl shadow-xl border border-gray-100">
        
        <!-- Session Timer -->
        {#if sessionToken && !loading && !needsLogin && !isExpired && !alreadyProcessed}
            <div class="mb-6 p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-center justify-between">
                <div class="flex items-center">
                    <Clock class="w-5 h-5 text-blue-600 mr-2" />
                    <span class="text-sm text-blue-800">Session expires in: <strong>{timeRemaining}</strong></span>
                </div>
                <span class="text-xs text-blue-600">Logged in as {staffEmail}</span>
            </div>
        {/if}

        <div class="flex flex-col items-center mb-8">
            <CheckCircle class="w-12 h-12 text-indigo-600 mb-3" />
            <h1 class="text-3xl font-bold text-gray-800 mb-2">Visitor Approval</h1>
            <p class="text-gray-500">Review and take action</p>
        </div>

        {#if message.text}
            <div class="p-4 mb-6 rounded-lg text-sm font-medium {message.type === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : message.type === 'info' ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-green-50 text-green-700 border border-green-200'}" role="alert">
                {message.text}
            </div>
        {/if}

        {#if loading}
            <div class="text-center mt-10">
                <RefreshCw class="w-12 h-12 text-indigo-600 animate-spin mx-auto mb-3" />
                <p class="text-lg text-gray-600">Authenticating...</p>
            </div>

        {:else if needsLogin}
            <div class="text-center mt-10 p-8 bg-red-50 rounded-xl border-2 border-red-200">
                <AlertTriangle class="w-16 h-16 text-red-500 mx-auto mb-4" />
                <h2 class="text-2xl font-bold text-red-700 mb-3">
                    {sessionLimitReached ? 'Session Limit Reached' : 'Authentication Required'}
                </h2>
                <p class="text-red-600 mb-4">
                    {sessionLimitReached ? 'Maximum login attempts (10) reached. Please contact support.' : 'This approval link is invalid or has expired.'}
                </p>
                {#if !sessionLimitReached}
                    <button 
                        on:click={() => window.location.reload()}
                        class="px-6 py-3 bg-red-600 text-white rounded-xl hover:bg-red-700"
                    >
                        Retry Login
                    </button>
                {/if}
            </div>

        {:else if isExpired}
            <div class="text-center mt-10 p-8 bg-orange-50 rounded-xl border-2 border-orange-200">
                <Clock class="w-16 h-16 text-orange-500 mx-auto mb-4" />
                <h2 class="text-2xl font-bold text-orange-700 mb-3">Request Expired</h2>
                <p class="text-orange-600">This approval link was valid only for the request day and has now expired.</p>
            </div>

        {:else if alreadyProcessed}
            <div class="text-center mt-10 p-8 bg-gray-50 rounded-xl border-2 border-gray-200">
                <svelte:component this={getStatusIcon(visitorLog.status)} class="w-16 h-16 text-gray-600 mx-auto mb-4" />
                <h2 class="text-2xl font-bold text-gray-700 mb-3">Processed</h2>
                <p class="text-gray-600">This request has been {visitorLog.status}.</p>
            </div>

        {:else if visitorLog}
            <div class="space-y-6">
                <!-- Visitor Details -->
                <div class="bg-gray-50 p-6 rounded-xl border">
                    <h2 class="text-xl font-semibold text-gray-800 mb-4 flex items-center">
                        <User class="w-5 h-5 mr-2 text-indigo-600" />
                        Visitor Details
                    </h2>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-gray-700">
                        <div class="flex items-start">
                            <User class="w-4 h-4 mr-2 mt-1 text-gray-400" />
                            <div>
                                <span class="block text-gray-500 text-xs">Name</span>
                                {visitorLog.visitorName}
                            </div>
                        </div>
                        <div class="flex items-start">
                            <Mail class="w-4 h-4 mr-2 mt-1 text-gray-400" />
                            <div>
                                <span class="block text-gray-500 text-xs">Email</span>
                                {visitorLog.visitorEmail}
                            </div>
                        </div>
                        <div class="flex items-start">
                            <Phone class="w-4 h-4 mr-2 mt-1 text-gray-400" />
                            <div>
                                <span class="block text-gray-500 text-xs">Phone</span>
                                {visitorLog.visitorPhone}
                            </div>
                        </div>
                        <div class="flex items-start">
                            <Building class="w-4 h-4 mr-2 mt-1 text-gray-400" />
                            <div>
                                <span class="block text-gray-500 text-xs">Company</span>
                                {visitorLog.companyName}
                            </div>
                        </div>
                        <div class="flex items-start">
                            <Users class="w-4 h-4 mr-2 mt-1 text-gray-400" />
                            <div>
                                <span class="block text-gray-500 text-xs">Members</span>
                                {visitorLog.totalMembers}
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Meeting Details -->
                <div class="bg-indigo-50 p-6 rounded-xl border border-indigo-200">
                    <h2 class="text-xl font-semibold text-gray-800 mb-4">Meeting Details</h2>
                    <div class="space-y-3 text-gray-700">
                        <div>
                            <span class="block text-gray-500 text-xs">Purpose</span>
                            {visitorLog.purpose}
                        </div>
                        {#if visitorLog.productsDesc && visitorLog.productsDesc !== 'N/A'}
                            <div class="flex items-start">
                                <Package class="w-4 h-4 mr-2 mt-1 text-gray-400" />
                                <div>
                                    <span class="block text-gray-500 text-xs">Products</span>
                                    {visitorLog.productsDesc}
                                </div>
                            </div>
                        {/if}
                    </div>
                </div>

                <!-- Pass Date -->
                <div class="bg-white p-6 rounded-xl border border-gray-200">
                    <h2 class="text-xl font-semibold text-gray-800 mb-4 flex items-center">
                        <Clock class="w-5 h-5 mr-2 text-indigo-600" />
                        Pass Date
                    </h2>
                    <div>
                        <label for="passDate" class="block text-sm font-medium text-gray-700 mb-2">
                            Select the date this pass is valid for
                        </label>
                        <input 
                            id="passDate"
                            type="date"
                            bind:value={passDate}
                            class="w-full sm:w-64 p-3 border border-gray-300 rounded-xl 
                                focus:ring-indigo-500 focus:border-indigo-500 text-gray-800"
                            disabled={submitting}
                        />
                        <p class="text-xs text-gray-400 mt-2">
                            Defaults to today if not changed
                        </p>
                    </div>
                </div>

                <!-- Actions -->
                {#if visitorLog.status === 'pending'}
                    <div class="mt-10 pt-6 border-t space-y-4">
                        <h2 class="text-xl font-semibold text-gray-700">Actions</h2>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">
                                Notes (Optional) - Visible to visitor
                            </label>
                            <textarea 
                                bind:value={approvalNotes} 
                                placeholder="Add instructions..." 
                                class="w-full p-3 border rounded-xl focus:ring-indigo-500 focus:border-indigo-500" 
                                rows="3" 
                                disabled={submitting}
                            ></textarea>
                        </div>
                        <div class="flex justify-center space-x-4">
                            <button 
                                on:click={openApproveDialog}
                                class="flex items-center py-3 px-6 bg-green-600 text-white font-bold rounded-xl hover:bg-green-700" 
                                disabled={submitting}
                            >
                                <CheckCircle class="w-5 h-5 mr-2" />
                                Approve
                            </button>
                            <button 
                                on:click={openRejectDialog} 
                                class="flex items-center py-3 px-6 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700" 
                                disabled={submitting}
                            >
                                <XCircle class="w-5 h-5 mr-2" />
                                Reject
                            </button>
                        </div>
                    </div>
                {/if}
            </div>
        {:else}
            <div class="text-center mt-10 text-gray-600">
                <p>Unable to load visitor request</p>
            </div>
        {/if}
    </div>
</div>