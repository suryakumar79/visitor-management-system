<script>
    import QRCode from 'qrcode';
    import { onMount } from 'svelte';
    import { page } from '$app/stores';
    import { goto } from '$app/navigation';
    import { visitorService } from '$lib/visitorService';
    import { User, Building, Phone, FileText } from 'lucide-svelte';

    let logId = $page.url.searchParams.get('logId');
    let visitorLog = null;
    let selfieUrl = '';
    let qrCodeUrl = '';
    let loading = true;
    let error = '';
    let isExpired = false;

    // ✅ OPTIMIZED: Cache expiry calculations
    const expiryCache = new Map();

    function isPassExpired(passDate, approvalTime) {
        const dateToCheck = passDate || approvalTime;
        if (!dateToCheck) return false;

        if (expiryCache.has(dateToCheck)) {
            return expiryCache.get(dateToCheck);
        }

        let passDay;

        if (passDate && /^\d{4}-\d{2}-\d{2}$/.test(passDate)) {
            // ✅ Parse YYYY-MM-DD string directly (avoids UTC timezone shift)
            const [year, month, day] = passDate.split('-').map(Number);
            passDay = new Date(year, month - 1, day); // Local time, no UTC issue
        } else {
            // Fallback for approvalTime (full ISO datetime)
            passDay = new Date(dateToCheck);
        }

        passDay.setHours(0, 0, 0, 0);

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const expired = passDay < today;
        expiryCache.set(dateToCheck, expired);
        return expired;
    }

    // ✅ OPTIMIZED: Parallel data loading
    onMount(async () => {
        if (!logId) {
            error = 'Invalid pass request';
            loading = false;
            setTimeout(() => goto('/visitor/login'), 3000);
            return;
        }

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);

            const response = await visitorService.getVisitorLog(logId);
            clearTimeout(timeoutId);

            if (!response.success) {
                throw new Error(response.message || 'Failed to load pass');
            }

            visitorLog = response.log;
           
            // Check if approved or checked in
            const normalizedStatus = visitorLog.status?.toLowerCase() || '';
            const canViewPass = normalizedStatus === 'approved' || 
                               normalizedStatus === 'checked-in' ||
                               normalizedStatus === 'partial-checkout';
            
            if (!canViewPass) {
                error = 'This pass is not approved yet';
                loading = false;
                setTimeout(() => goto(`/visitor/status?logId=${logId}`), 3000);
                return;
            }

            // Check if pass is expired
            isExpired = isPassExpired(visitorLog.passDate, visitorLog.approvalTime);
            if (isExpired) {
                error = 'This visitor pass has expired';
                loading = false;
                return;
            }

            // ✅ OPTIMIZED: Load selfie in parallel (non-blocking)
            if (visitorLog.selfieFileId) {
                visitorService.getSelfieUrl(visitorLog.selfieFileId)
                    .then(selfieResponse => {
                        if (selfieResponse.success) {
                            selfieUrl = selfieResponse.url;
                        }
                    })
                    .catch(err => {
                        console.error('Failed to load selfie:', err);
                    });
            }

            // ✅ OPTIMIZED: Generate QR code (instant, external service)
            generateQRCode(logId);

        } catch (err) {
            if (err.name === 'AbortError') {
                error = 'Request timed out. Please refresh.';
            } else {
                console.error('Failed to load visitor pass:', err);
                error = err.message || 'Failed to load visitor pass';
            }
        } finally {
            loading = false;
        }
    });

    // The QR code is drawn locally in the browser: the pass id is never sent to another server.
    async function generateQRCode(id) {
        const verificationData = { type: 'visitor_pass', logId: id, timestamp: Date.now() };
        qrCodeUrl = await QRCode.toDataURL(JSON.stringify(verificationData), { width: 300, margin: 1, errorCorrectionLevel: 'M' });
    }

    function maskPhone(phone) {
        if (!phone) return '';
        const last4 = phone.slice(-4);
        return `******${last4}`;
    }

    function formatShortDate(timestamp) {
        if (!timestamp) return 'N/A';
        try {
            const date = new Date(timestamp);
            return date.toLocaleDateString('en-IN', {
                day: '2-digit',
                month: 'short',
                year: 'numeric'
            });
        } catch {
            return 'Invalid Date';
        }
    }

    function getExpiryTime() {
        const today = new Date();
        today.setHours(20, 0, 0, 0);
        return today.toLocaleTimeString('en-IN', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });
    }
</script>

<svelte:head>
    <title>Visitor Pass</title>
    <style>
        @media print {
            @page {
                size: 3.5in 5.5in;
                margin: 0;
            }
            body { 
                margin: 0; 
                padding: 0;
                background: white !important;
            }
            .print-hidden { 
                display: none !important; 
            }
            * {
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
            }
        }
    </style>
</svelte:head>

{#if loading}
    <div class="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-900 to-blue-700">
        <div class="text-center">
            <div class="w-16 h-16 border-4 border-white border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p class="text-white">Loading your visitor pass...</p>
        </div>
    </div>
{:else if error || !visitorLog}
    <div class="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div class="text-center max-w-md mx-auto">
            {#if isExpired}
                <div class="bg-red-50 p-8 rounded-2xl border-2 border-red-300">
                    <div class="text-red-500 text-6xl mb-4">🚫</div>
                    <h1 class="text-3xl font-bold text-red-700 mb-3">Pass Expired</h1>
                    <p class="text-red-600 mb-4">This visitor pass was approved for a previous date and has expired.</p>
                    <p class="text-sm text-red-500">Please request a new visitor pass for today's visit.</p>
                    <a href="/visitor/login" class="mt-6 inline-block px-6 py-3 bg-red-600 text-white font-semibold rounded-xl hover:bg-red-700 transition">
                        Request New Pass
                    </a>
                </div>
            {:else}
                <div class="text-red-500 text-6xl mb-4">⚠️</div>
                <h1 class="text-2xl font-bold text-gray-800 mb-2">Pass Not Available</h1>
                <p class="text-gray-600">{error || 'Unable to load visitor pass'}</p>
            {/if}
        </div>
    </div>
{:else}
    <div class="min-h-screen bg-gradient-to-br from-blue-900 to-blue-700 flex items-center justify-center p-4 print:bg-white print:p-0">
        <div class="w-full max-w-md print:max-w-none">
            <div class="bg-gradient-to-b from-blue-800 to-blue-900 rounded-3xl shadow-2xl overflow-hidden print:rounded-none" style="width: 100%; max-width: 350px; margin: 0 auto;">
                
                <div class="bg-blue-900 text-center py-3">
                    <h1 class="text-white text-lg font-bold tracking-wide">Visitor Pass</h1>
                </div>

                <div class="flex justify-center py-4 px-4">
                    <div class="relative">
                        {#if selfieUrl}
                            <img 
                                src={selfieUrl} 
                                alt="Visitor"
                                class="w-36 h-36 rounded-full object-cover border-4 border-white shadow-xl"
                            />
                        {:else}
                            <div class="w-36 h-36 rounded-full bg-blue-700 border-4 border-white shadow-xl flex items-center justify-center">
                                <User class="w-20 h-20 text-white" />
                            </div>
                        {/if}
                    </div>
                </div>

                <div class="text-center px-6 pb-2">
                    <h2 class="text-white text-lg font-bold">{visitorLog.visitorName}</h2>
                </div>

                <div class="text-center px-6 pb-2">
                    <p class="text-blue-300 text-sm font-mono">ID: {logId.slice(0, 12)}</p>
                </div>

                <div class="text-center px-6 pb-3 border-b border-blue-700">
                    <p class="text-white text-sm">VALIDITY: {formatShortDate(visitorLog?.passDate || visitorLog?.approvalTime)} • {getExpiryTime()}</p>
                </div>

                <div class="px-6 py-3 text-center border-b border-blue-700">
                    <p class="text-blue-200 text-xs uppercase tracking-wider mb-1">
                        TO MEET: <span class="font-bold">{visitorLog.staffName}</span>
                    </p>
                    
                    {#if visitorLog.departmentName}
                        <p class="text-blue-300 text-sm mt-1">at {visitorLog.departmentName}</p>
                    {/if}
                </div>

                <div class="px-3 py-3 space-y-2 border-b border-blue-700">
                    {#if visitorLog.companyName}
                        <div class="flex items-center justify-center gap-2">
                            <Building class="w-4 h-4 text-blue-300 flex-shrink-0" />
                            <span class="text-white text-sm">{visitorLog.companyName}</span>
                        </div>
                    {/if}
                    <div class="flex items-center justify-center gap-2">
                        <Phone class="w-4 h-4 text-blue-300 flex-shrink-0" />
                        <span class="text-white text-sm font-mono">{maskPhone(visitorLog.visitorPhone)}</span>
                    </div>
                    <div class="flex items-center justify-center gap-2">
                        <User class="w-4 h-4 text-blue-300 flex-shrink-0" />
                        <span class="text-white text-sm">{visitorLog.totalMembers} {visitorLog.totalMembers > 1 ? 'members' : 'member'}</span>
                    </div>
                </div>

                <div class="flex justify-center py-4 px-3">
                    <div class="bg-white p-2 rounded-xl shadow-lg">
                        <img 
                            src={qrCodeUrl} 
                            alt="QR Code"
                            class="w-28 h-28"
                        />
                    </div>
                </div>

                <div class="bg-blue-950 text-center py-3 px-6 border-t border-blue-900">
                    <p class="text-blue-400 text-xs">✓ Approved — Show this QR code at Reception</p>
                </div>
            </div>

            {#if visitorLog.notes && visitorLog.notes.trim()}
                <div class="mt-4 px-4 py-3 bg-blue-800 rounded-lg print-hidden">
                    <p class="text-blue-200 text-xs font-semibold mb-1 flex items-center gap-1">
                        <FileText class="w-3 h-3" />
                        STAFF NOTE:
                    </p>
                    <p class="text-white text-xs leading-relaxed">{visitorLog.notes}</p>
                </div>
            {/if}

            <div class="mt-8 px-6 py-5 bg-blue-950 border-t border-blue-900 rounded-lg print-hidden">
                <p class="text-blue-200 text-xs font-semibold mb-3 uppercase tracking-wide">Visitor Policy</p>
                <ol class="text-blue-300 text-[10px] space-y-1.5 list-decimal list-inside leading-relaxed">
                    
                    <li>Entry is permitted only for the purpose and duration approved.</li>
                    <li>Visitors must follow all security and safety instructions.</li>
                    <li>This pass must be rescanned at the reception before leaving.</li>
                    <li>Any unauthorized access or misuse of this pass is strictly prohibited.</li>
                </ol>
            </div>
        </div>
    </div>
{/if}