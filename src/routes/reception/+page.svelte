<script>
    import jsQR from 'jsqr';
    import { onMount, onDestroy } from 'svelte';
    import { goto } from '$app/navigation';
    import { account } from '$lib/client';
    import { QrCode, UserCheck, Users, LogOut, CheckCircle, XCircle, Camera, RefreshCw, X } from 'lucide-svelte';

    // State management
    let stats = {
        totalCheckedIn: 0,
        currentlyInside: 0,
        checkedOut: 0,
        totalVisitorsIn: 0
    };
    let showScanner = false;
    let scanning = false;
    let scanResult = null;
    let scanMessage = { text: '', type: '' };
    let loading = true;
    let videoStream = null;
    let videoElement = null;
    let canvasElement = null;
    let scannerInterval = null;
    let showMemberCountSelector = false;
    let currentVisitorLog = null;
    let selectedMemberCount = 1;
    let isCheckoutFlow = false;
    let session = null;
    let manualQrInput = '';
    
    // Auto-refresh interval
    let dashboardRefreshInterval = null;
     // Session validation interval
    let sessionValidationInterval = null;

    async function handleLogout() {
    try {
        // 1. Try to destroy session 
        try {
            await account.deleteSession('current');
            console.log('✅ session destroyed');
        } catch (sessionError) {
            // Session might already be terminated by admin or expired
            if (sessionError.code === 401 || sessionError.message.includes('missing scopes')) {
                console.log('ℹ️ Session already terminated or expired');
            } else {
                console.error('Failed to destroy session:', sessionError);
            }
            // Don't throw - continue with logout
        }
        
        // 2. Clear sessionStorage
        sessionStorage.removeItem('receptionistSession');
        console.log('✅ SessionStorage cleared');
        
        // 4. Redirect to login
        goto('/reception/login');
        
    } catch (error) {
        console.error('Logout error:', error);
        // Force logout even if there are errors
        sessionStorage.removeItem('receptionistSession');
        goto('/reception/login');
    }
}

// NEW: Validate session
    async function validateSession() {
        try {
            // Try to get current account - this will fail if session is invalid
            await account.get();
            return true;
        } catch (error) {
            if (error.code === 401 || error.message.includes('missing scopes')) {
                console.log('⚠️ Session validation failed - logging out');
                // Session is invalid, force logout
                sessionStorage.removeItem('receptionistSession');
                alert('Your session has been terminated by an administrator. Please login again.');
                goto('/reception/login');
                return false;
            }
            // Other errors might be network issues, don't logout
            console.warn('Session validation error (non-critical):', error);
            return true;
        }
    }
    // API call wrapper
    async function apiCall(endpoint, data) {
        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || 'Request failed');
            }

            return await response.json();
        } catch (error) {
            throw error;
        }
    }

    onMount(async () => {
        // Early session check
        const sessionData = sessionStorage.getItem('receptionistSession');
        if (!sessionData) {
            goto('/reception/login');
            return;
        }
        
        try {
            session = JSON.parse(sessionData);
        } catch {
            goto('/reception/login');
            return;
        }
         
        // Validate session on mount
        const isValid = await validateSession();
        if (!isValid) return;

        await loadDashboardData();
        
        // 60s refresh
        dashboardRefreshInterval = setInterval(loadDashboardData, 60000);

        sessionValidationInterval = setInterval(validateSession, 30000);
    });

    onDestroy(() => {
        if (dashboardRefreshInterval) clearInterval(dashboardRefreshInterval);
        if (sessionValidationInterval) clearInterval(sessionValidationInterval);
        stopCamera();
    });

    // Load dashboard statistics
    async function loadDashboardData() {
        try {
            const result = await apiCall('/api/receptionists/dashboard', {
                action: 'getStats'
            });

            if (result.success) {
                stats = result.stats;
            }
        } catch (error) {
            console.error('Failed to load dashboard data:', error);
        } finally {
            loading = false;
        }
    }

    async function startScanner() {
        showScanner = true;
        scanMessage = { text: '', type: '' };
        scanResult = null;
        showMemberCountSelector = false;
        
        document.body.style.overflow = 'hidden';
        // Longer delay for mobile DOM rendering
        await new Promise(resolve => setTimeout(resolve, 300));
        
        try {
            videoElement = document.getElementById('qr-video');
            canvasElement = document.getElementById('qr-canvas');
            
            if (!videoElement || !canvasElement) {
                scanMessage = { text: 'Scanner initialization failed. Please try again.', type: 'error' };
                console.error('Video/Canvas elements not found');
                return;
            }

            console.log('Requesting camera access...');

            // Mobile-optimized constraints
            const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
            const constraints = {
                video: {
                    facingMode: { ideal: 'environment' },
                    width: { ideal: isMobile ? 1280 : 1920 },
                    height: { ideal: isMobile ? 720 : 1080 },
                    // Additional mobile optimizations
                    aspectRatio: { ideal: 4/3 },
                    frameRate: { ideal: isMobile ? 15 : 30 }
                }
            };

            videoStream = await navigator.mediaDevices.getUserMedia(constraints);
            videoElement.srcObject = videoStream;
            videoElement.setAttribute('playsinline', 'true');
            videoElement.setAttribute('webkit-playsinline', 'true'); // iOS specific
            videoElement.setAttribute('muted', 'true');
            videoElement.setAttribute('autoplay', 'true');
            
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Video load timeout')), 10000);
                
                videoElement.onloadedmetadata = () => {
                    clearTimeout(timeout);
                    console.log('Video metadata loaded, starting playback...');
                    videoElement.play()
                        .then(() => {
                            console.log('Video playing, dimensions:', videoElement.videoWidth, 'x', videoElement.videoHeight);
                            resolve();
                        })
                        .catch(reject);
                };
            });

            scanMessage = { text: 'Camera ready. Position QR code in the frame.', type: 'success' };
            
            // Longer stabilization time for mobile
            setTimeout(() => {
                console.log('Starting QR detection...');
                startQRDetection();
            }, isMobile ? 1500 : 1000);
            
        } catch (error) {
            console.error('Camera access error:', error);
            scanMessage = { text: `Camera access error: ${error.message}. Please allow camera access in browser settings.`, type: 'error' };
            showScanner = false;
            document.body.style.overflow = '';
        }
    }

    function startQRDetection() {
        if (!videoElement || !canvasElement) {
            console.error('Video or canvas element not found');
            return;
        }


        const canvas = canvasElement;
        const video = videoElement;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

        console.log('Starting QR detection...');
        let scanAttempts = 0;
        let lastScanTime = 0;
        const scanInterval = isMobile ? 400 : 300; // Slower on mobile to reduce CPU load

        scannerInterval = setInterval(() => {
            const now = Date.now();
            if (now - lastScanTime < scanInterval) return;
            lastScanTime = now;

            if (video.readyState === video.HAVE_ENOUGH_DATA && !scanning) {
                scanAttempts++;
                
                // Log every 10 attempts
                if (scanAttempts % 10 === 0) {
                    console.log(`Scanning... (${scanAttempts} attempts)`);
                }
                
                canvas.height = video.videoHeight;
                canvas.width = video.videoWidth;
                
                context.drawImage(video, 0, 0, canvas.width, canvas.height);
                const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
                
                const code = jsQR(imageData.data, imageData.width, imageData.height, {
                    inversionAttempts: "attemptBoth",
                });

                if (code && code.data) {
                    console.log('✅ QR Code detected:', code.data);
                    clearInterval(scannerInterval);
                    scannerInterval = null;
                    
                    // Haptic feedback on mobile
                    if (isMobile && navigator.vibrate) {
                        navigator.vibrate(200);
                    }
                    
                    // Close scanner modal first
                    closeScanner();
                    
                    // Then process the scan on main page
                    processQRScan(code.data);
                }
            }
        }, scanInterval);
    }

    function stopCamera() {
        if (scannerInterval) {
            clearInterval(scannerInterval);
            scannerInterval = null;
        }
        
        if (videoStream) {
            videoStream.getTracks().forEach(track => track.stop());
            videoStream = null;
        }

        if (videoElement) {
            videoElement.srcObject = null;
        }
    }

    function closeScanner() {
        console.log('Closing scanner...');
        stopCamera();
        // Use requestAnimationFrame for smoother UI updates
        requestAnimationFrame(() => {
            showScanner = false;
            document.body.style.overflow = '';
        });
    }

    async function handleManualInput(event) {
        event.preventDefault();
        const qrData = manualQrInput.trim();
        
        if (!qrData) {
            scanMessage = { text: 'Please enter QR code data or Log ID', type: 'error' };
            return;
        }

        await processQRScan(qrData);
        manualQrInput = '';
    }

    async function processQRScan(qrData) {

        // Validate session before processing
    const isValid = await validateSession();
    if (!isValid) return;

    scanning = true;
    scanMessage = { text: 'Processing...', type: 'success' };
    
    try {
        let logId;
        
        // Try to parse as JSON (from QR code scan)
        try {
            const parsed = JSON.parse(decodeURIComponent(qrData));
            logId = parsed.logId;
            
            // If logId is undefined/null after parsing, treat input as raw ID
            if (!logId) {
                logId = qrData.trim();
            }
        } catch {
            // If parsing fails, treat the entire input as a logId
            logId = qrData.trim();
        }

        if (!logId || logId === '') {
            scanMessage = { text: 'Please enter a valid QR code data or Log ID', type: 'error' };
            scanning = false;
            return;
        }

        console.log('Processing Log ID:', logId);

            // Get visitor log details
            const result = await apiCall('/api/receptionists/dashboard', {
                action: 'processQRScan',
                logId: logId,
                receptionistId: session.id,
                receptionistName: session.name
            });

            if (!result.success) {
                scanResult = { 
                    success: false, 
                    visitor: result.log, 
                    action: result.action || 'error',
                    message: result.message 
                };
                scanMessage = { text: result.message, type: 'error' };
                scanning = false;
                return;
            }

            currentVisitorLog = result.log;
            const totalMembers = result.log.totalMembers || 1;
            const totalMembersOut = parseInt(result.log.totalMembersOut) || 0;

            if (result.log.status === 'approved') {
                if (totalMembers === 1) {
                    await performCheckin(result.log, 1);
                } else {
                    selectedMemberCount = totalMembers;
                    isCheckoutFlow = false;
                    showMemberCountSelector = true;
                    scanMessage = { text: 'Select number of members checking in', type: 'success' };
                    scanning = false;
                }
            } else if (result.log.status === 'checked-in' || result.log.status === 'partial-checkout') {
                const remainingMembers = totalMembers - totalMembersOut;
                
                if (remainingMembers === 1) {
                    await performCheckout(result.log, 1);
                } else if (remainingMembers > 1) {
                    selectedMemberCount = remainingMembers;
                    isCheckoutFlow = true;
                    showMemberCountSelector = true;
                    scanMessage = { text: `Select number of members checking out (${remainingMembers} remaining)`, type: 'success' };
                    scanning = false;
                } else {
                    scanResult = { success: false, visitor: result.log, action: 'invalid', message: 'Error: Invalid member count' };
                    scanMessage = { text: 'Invalid member count', type: 'error' };
                    scanning = false;
                }
            }

        } catch (error) {
            console.error('QR scan processing failed:', error);
            scanMessage = { text: `Error: ${error.message}. Please try again.`, type: 'error' };
            scanning = false;
        }
    }

    async function performCheckin(log, memberCount) {
        try {
            scanning = true;

            const result = await apiCall('/api/receptionists/dashboard', {
                action: 'checkin',
                logId: log.$id,
                memberCount: memberCount,
                receptionistId: session.id,
                receptionistName: session.name
            });

            if (result.success) {
                scanResult = {
                    success: true,
                    visitor: result.log,
                    action: 'checkin',
                    message: `${memberCount} Member${memberCount > 1 ? 's' : ''} Successfully Checked In ✓`
                };

                scanMessage = { text: 'Check-in Successful!', type: 'success' };
                await loadDashboardData();
            } else {
                scanMessage = { text: `Failed: ${result.message || 'Unknown error'}`, type: 'error' };
            }
        } catch (error) {
            console.error('Check-in failed:', error);
            scanMessage = { text: `Error: ${error.message}`, type: 'error' };
        } finally {
            scanning = false;
            showMemberCountSelector = false;
        }
    }

    async function performCheckout(log, memberCount) {
        try {
            scanning = true;

            const result = await apiCall('/api/receptionists/dashboard', {
                action: 'checkout',
                logId: log.$id,
                memberCount: memberCount,
                receptionistId: session.id,
                receptionistName: session.name
            });

            if (result.success) {
                const remainingMembers = (log.totalMembers || 1) - result.totalMembersOut;

                scanResult = {
                    success: true,
                    visitor: result.log,
                    action: 'checkout',
                    message: result.isFullCheckout
                        ? `All ${log.totalMembers} Members Successfully Checked Out ✓`
                        : `${memberCount} Member${memberCount > 1 ? 's' : ''} Checked Out (${remainingMembers} still inside)`
                };

                scanMessage = { 
                    text: result.isFullCheckout ? 'Full Check-out Successful!' : 'Partial Check-out Recorded', 
                    type: 'success' 
                };

                await loadDashboardData();
            } else {
                scanMessage = { text: `Failed: ${result.message || 'Unknown error'}`, type: 'error' };
            }
        } catch (error) {
            console.error('Check-out failed:', error);
            scanMessage = { text: `Error: ${error.message}`, type: 'error' };
        } finally {
            scanning = false;
            showMemberCountSelector = false;
        }
    }

    async function handleMemberCountSubmit() {
        if (!currentVisitorLog) return;

        if (isCheckoutFlow) {
            await performCheckout(currentVisitorLog, selectedMemberCount);
        } else {
            await performCheckin(currentVisitorLog, selectedMemberCount);
        }
    }

    // Status badge helper
    const statusBadges = {
        'pending': { class: 'bg-yellow-100 text-yellow-800', text: 'Pending' },
        'approved': { class: 'bg-green-100 text-green-800', text: 'Approved' },
        'rejected': { class: 'bg-red-100 text-red-800', text: 'Rejected' },
        'checked-in': { class: 'bg-blue-100 text-blue-800', text: 'Checked In' },
        'checked-out': { class: 'bg-gray-100 text-gray-800', text: 'Checked Out' },
        'partial-checkout': { class: 'bg-orange-100 text-orange-800', text: 'Partial Out' }
    };

    function getStatusBadge(status) {
        return statusBadges[status] || statusBadges['pending'];
    }
</script>

<svelte:head>
    <title>Receptionist Dashboard</title>
</svelte:head>

<div class="min-h-screen bg-gray-50">
    <!-- Header -->
    <div class="bg-white shadow-sm border-b border-gray-200">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
            <div class="flex items-center justify-between">
                <div>
                    <h1 class="text-xl sm:text-2xl font-bold text-gray-900">Receptionist Dashboard</h1>
                    <a href="/reception/bookings" class="text-sm font-medium text-indigo-600 underline">🗓️ Today's pre-bookings</a>
                    <p class="text-xs sm:text-sm text-gray-600 mt-1">Visitor Management System</p>
                    {#if session}
                        <p class="text-xs text-gray-500 mt-1">Logged in as: <span class="font-semibold">{session.name}</span></p>
                    {/if}
                </div>
                <button on:click={handleLogout} class="flex items-center gap-2 px-3 sm:px-4 py-2 sm:py-3 bg-red-600 text-white font-semibold rounded-xl hover:bg-red-700 active:bg-red-800 transition duration-150 shadow-lg touch-manipulation" title="Logout">
                    <LogOut class="w-4 h-4 sm:w-5 sm:h-5" />
                    <span class="hidden sm:inline">Logout</span>
                </button>
            </div>
        </div>
    </div>

    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8">
        <!-- Stats Cards -->
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 mb-6 sm:mb-8">
            <div class="bg-white rounded-xl sm:rounded-2xl shadow-lg p-4 sm:p-6 border-l-4 border-blue-500">
                <div class="flex items-center justify-between">
                    <div>
                        <p class="text-xs sm:text-sm font-medium text-gray-600">Checked In Today</p>
                        <p class="text-2xl sm:text-3xl font-bold text-gray-900 mt-1 sm:mt-2">{stats.totalCheckedIn}</p>
                        <p class="text-xs text-gray-500 mt-1">Total visitors who checked in</p>
                    </div>
                    <div class="bg-blue-100 p-3 sm:p-4 rounded-full">
                        <UserCheck class="w-6 h-6 sm:w-8 sm:h-8 text-blue-600" />
                    </div>
                </div>
            </div>

            <div class="bg-white rounded-xl sm:rounded-2xl shadow-lg p-4 sm:p-6 border-l-4 border-green-500">
                <div class="flex items-center justify-between">
                    <div>
                        <p class="text-xs sm:text-sm font-medium text-gray-600">Total Visitors In</p>
                        <p class="text-2xl sm:text-3xl font-bold text-gray-900 mt-1 sm:mt-2">{stats.totalVisitorsIn}</p>
                        <p class="text-xs text-gray-500 mt-1">Currently inside premises</p>
                    </div>
                    <div class="bg-green-100 p-3 sm:p-4 rounded-full">
                        <Users class="w-6 h-6 sm:w-8 sm:h-8 text-green-600" />
                    </div>
                </div>
            </div>

            <div class="bg-white rounded-xl sm:rounded-2xl shadow-lg p-4 sm:p-6 border-l-4 border-gray-500">
                <div class="flex items-center justify-between">
                    <div>
                        <p class="text-xs sm:text-sm font-medium text-gray-600">Checked Out Today</p>
                        <p class="text-2xl sm:text-3xl font-bold text-gray-900 mt-1 sm:mt-2">{stats.checkedOut}</p>
                        <p class="text-xs text-gray-500 mt-1">Completed visits</p>
                    </div>
                    <div class="bg-gray-100 p-3 sm:p-4 rounded-full">
                        <LogOut class="w-6 h-6 sm:w-8 sm:h-8 text-gray-600" />
                    </div>
                </div>
            </div>
        </div>

        <!-- QR Scanner Section -->
        <div class="bg-white rounded-xl sm:rounded-2xl shadow-lg overflow-hidden">
            <div class="px-4 sm:px-6 py-3 sm:py-4 bg-gradient-to-r from-indigo-600 to-purple-600">
                <h2 class="text-lg sm:text-xl font-bold text-white flex items-center gap-2">
                    <QrCode class="w-5 h-5 sm:w-6 sm:h-6" />
                    Scan Visitor Pass
                </h2>
                <p class="text-indigo-100 text-xs sm:text-sm mt-1">Scan QR code or enter Log ID manually</p>
            </div>

            <div class="p-4 sm:p-8">
                <!-- Camera Scanner Button -->
                <div class="text-center mb-4 sm:mb-6">
                    <button 
                        on:click={startScanner} 
                        class="inline-flex items-center gap-2 sm:gap-3 px-6 sm:px-8 py-3 sm:py-4 bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-bold text-base sm:text-lg rounded-xl hover:from-indigo-700 hover:to-purple-700 active:from-indigo-800 active:to-purple-800 transition duration-150 shadow-xl transform active:scale-95 touch-manipulation"
                    >
                        <Camera class="w-5 h-5 sm:w-6 sm:h-6" />
                        Open Camera Scanner
                    </button>
                    <p class="text-xs sm:text-sm text-gray-500 mt-2 sm:mt-3">Click to open camera and scan QR code</p>
                </div>

                <!-- Divider - Hide when member count selector or scan result is shown -->
                {#if !showMemberCountSelector && !scanResult}
                    <div class="relative my-6 sm:my-8">
                        <div class="absolute inset-0 flex items-center">
                            <div class="w-full border-t border-gray-300"></div>
                        </div>
                        <div class="relative flex justify-center text-xs sm:text-sm">
                            <span class="px-3 sm:px-4 bg-white text-gray-500 font-medium">OR ENTER MANUALLY</span>
                        </div>
                    </div>
                {/if}

                <!-- Manual Input - Hide when member count selector or scan result is shown -->
                {#if !showMemberCountSelector && !scanResult}
                    <div class="max-w-2xl mx-auto">
                        {#if scanMessage.text}
                            <div class="mb-4 p-3 sm:p-4 rounded-lg {scanMessage.type === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-green-50 text-green-700 border border-green-200'}">
                                <div class="flex items-center gap-2">
                                    {#if scanMessage.type === 'error'}
                                        <XCircle class="w-5 h-5 flex-shrink-0" />
                                    {:else}
                                        <CheckCircle class="w-5 h-5 flex-shrink-0" />
                                    {/if}
                                    <span class="text-sm sm:text-base">{scanMessage.text}</span>
                                </div>
                            </div>
                        {/if}

                        <form on:submit={handleManualInput} class="flex flex-col sm:flex-row gap-3">
                            <input 
                                bind:value={manualQrInput}
                                type="text" 
                                placeholder="Paste QR code data or enter Log ID" 
                                class="flex-1 px-4 py-3 border-2 border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-base sm:text-lg"
                                disabled={scanning}
                            />
                            <button 
                                type="submit" 
                                class="w-full sm:w-auto px-6 sm:px-8 py-3 bg-indigo-600 text-white font-semibold text-base sm:text-lg rounded-xl hover:bg-indigo-700 active:bg-indigo-800 transition duration-150 shadow-lg touch-manipulation {scanning ? 'opacity-50 cursor-not-allowed' : ''}" 
                                disabled={scanning}
                            >
                                {scanning ? 'Processing...' : 'Submit'}
                            </button>
                        </form>
                    </div>
                {/if}

                <!-- Member Count Selector -->
                {#if showMemberCountSelector && currentVisitorLog}
                    <div class="max-w-2xl mx-auto mt-6 bg-blue-50 rounded-xl p-4 sm:p-6 border-2 border-blue-500">
                        <h4 class="text-base sm:text-lg font-bold text-blue-900 mb-4">
                            {isCheckoutFlow ? 'Select Members Checking Out' : 'Select Members Checking In'}
                        </h4>
                        
                        <div class="space-y-3 mb-4">
                            <div class="flex justify-between text-xs sm:text-sm">
                                <span class="text-gray-700">Visitor:</span>
                                <span class="font-semibold">{currentVisitorLog.visitorName}</span>
                            </div>
                            <div class="flex justify-between text-xs sm:text-sm">
                                <span class="text-gray-700">Total Members:</span>
                                <span class="font-semibold">{currentVisitorLog.totalMembers || 1}</span>
                            </div>
                            {#if isCheckoutFlow}
                                <div class="flex justify-between text-xs sm:text-sm">
                                    <span class="text-gray-700">Already Checked Out:</span>
                                    <span class="font-semibold">{parseInt(currentVisitorLog.totalMembersOut) || 0}</span>
                                </div>
                                <div class="flex justify-between text-xs sm:text-sm">
                                    <span class="text-gray-700">Still Inside:</span>
                                    <span class="font-semibold text-blue-600">{(currentVisitorLog.totalMembers || 1) - (parseInt(currentVisitorLog.totalMembersOut) || 0)}</span>
                                </div>
                            {/if}
                        </div>

                        <div class="mb-4">
                            <label class="block text-xs sm:text-sm font-medium text-gray-700 mb-2">
                                {isCheckoutFlow ? 'Number of members checking out:' : 'Number of members checking in:'}
                            </label>
                            <select bind:value={selectedMemberCount} class="w-full px-4 py-2 sm:py-3 border border-gray-300 rounded-xl focus:ring-blue-500 focus:border-blue-500 text-base">
                                {#if isCheckoutFlow}
                                    {#each Array((currentVisitorLog.totalMembers || 1) - (parseInt(currentVisitorLog.totalMembersOut) || 0)) as _, i}
                                        <option value={i + 1}>{i + 1}</option>
                                    {/each}
                                {:else}
                                    {#each Array(currentVisitorLog.totalMembers || 1) as _, i}
                                        <option value={i + 1}>{i + 1}</option>
                                    {/each}
                                {/if}
                            </select>
                        </div>

                        <div class="flex gap-2">
                            <button 
                                on:click={handleMemberCountSubmit} 
                                class="flex-1 px-4 py-2 sm:py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 active:bg-blue-800 transition duration-150 touch-manipulation {scanning ? 'opacity-50 cursor-not-allowed' : ''}" 
                                disabled={scanning}
                            >
                                {scanning ? 'Processing...' : 'Confirm'}
                            </button>
                            <button 
                                on:click={() => { showMemberCountSelector = false; scanMessage = { text: '', type: '' }; }} 
                                class="px-4 py-2 sm:py-3 bg-gray-200 text-gray-700 font-semibold rounded-xl hover:bg-gray-300 active:bg-gray-400 transition duration-150 touch-manipulation" 
                                disabled={scanning}
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                {/if}

                <!-- Scan Result -->
                {#if scanResult}
                    <div class="max-w-2xl mx-auto mt-6 bg-gray-50 rounded-xl p-4 sm:p-6 border-2 {scanResult.success ? 'border-green-500' : 'border-red-500'}">
                        <div class="flex items-center justify-center mb-4">
                            {#if scanResult.success}
                                <CheckCircle class="w-12 h-12 sm:w-16 sm:h-16 text-green-500" />
                            {:else}
                                <XCircle class="w-12 h-12 sm:w-16 sm:h-16 text-red-500" />
                            {/if}
                        </div>

                        <h4 class="text-lg sm:text-xl font-bold text-center mb-4 {scanResult.success ? 'text-green-700' : 'text-red-700'}">
                            {scanResult.message}
                        </h4>

                        <div class="space-y-2 text-xs sm:text-sm mb-4">
                            <div class="flex justify-between">
                                <span class="text-gray-600">Visitor:</span>
                                <span class="font-semibold text-gray-900">{scanResult.visitor.visitorName}</span>
                            </div>
                            <div class="flex justify-between">
                                <span class="text-gray-600">Company:</span>
                                <span class="font-semibold text-gray-900">{scanResult.visitor.companyName}</span>
                            </div>
                            <div class="flex justify-between">
                                <span class="text-gray-600">Meeting:</span>
                                <span class="font-semibold text-gray-900">{scanResult.visitor.staffName}</span>
                            </div>
                            <div class="flex justify-between">
                                <span class="text-gray-600">Status:</span>
                                <span class="px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full {getStatusBadge(scanResult.visitor.status).class}">
                                    {getStatusBadge(scanResult.visitor.status).text}
                                </span>
                            </div>
                            {#if scanResult.visitor.totalMembers && scanResult.visitor.totalMembers > 1}
                                <div class="flex justify-between">
                                    <span class="text-gray-600">Total Members:</span>
                                    <span class="font-semibold text-gray-900">{scanResult.visitor.totalMembers}</span>
                                </div>
                                {#if scanResult.visitor.status === 'partial-checkout' || scanResult.visitor.status === 'checked-out'}
                                    <div class="flex justify-between">
                                        <span class="text-gray-600">Checked Out:</span>
                                        <span class="font-semibold text-gray-900">{parseInt(scanResult.visitor.totalMembersOut) || 0}</span>
                                    </div>
                                    <div class="flex justify-between">
                                        <span class="text-gray-600">Still Inside:</span>
                                        <span class="font-semibold text-blue-600">{(scanResult.visitor.totalMembers || 1) - (parseInt(scanResult.visitor.totalMembersOut) || 0)}</span>
                                    </div>
                                {/if}
                            {/if}
                        </div>

                        <button 
                            on:click={() => { scanResult = null; scanMessage = { text: '', type: '' }; selectedMemberCount = 1; showMemberCountSelector = false; manualQrInput = ''; }} 
                            class="w-full px-4 py-2 sm:py-3 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 active:bg-indigo-800 transition duration-150 touch-manipulation"
                        >
                            Scan Another
                        </button>
                    </div>
                {/if}
            </div>
        </div>
    </div>
</div>

<!-- Camera Scanner Modal -->
{#if showScanner}
    <div class="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-50 p-0 sm:p-4">
        <div class="bg-white rounded-none sm:rounded-2xl shadow-2xl w-full h-full sm:w-auto sm:h-auto sm:max-w-2xl sm:max-h-[90vh] overflow-y-auto flex flex-col">
            <!-- Sticky Header -->
            <div class="px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white z-10 shadow-sm">
                <h3 class="text-lg sm:text-xl font-bold text-gray-900 flex items-center gap-2">
                    <Camera class="w-5 h-5 sm:w-6 sm:h-6 text-indigo-600" />
                    <span class="hidden sm:inline">Camera Scanner</span>
                    <span class="sm:hidden">Scan QR Code</span>
                </h3>
                <button 
                    on:click={closeScanner} 
                    class="text-gray-400 hover:text-gray-600 p-2 -m-2 active:bg-gray-100 rounded-lg transition-colors touch-manipulation"
                    aria-label="Close scanner"
                >
                    <X class="w-6 h-6 sm:w-7 sm:h-7" />
                </button>
            </div>

            <!-- Camera View -->
            <div class="p-4 sm:p-6 flex-1 flex flex-col">
                <div class="relative bg-gray-900 rounded-lg sm:rounded-xl overflow-hidden w-full" style="aspect-ratio: 4/3;">
                    <video 
                        id="qr-video" 
                        autoplay 
                        playsinline 
                        webkit-playsinline
                        muted 
                        class="w-full h-full object-cover"
                    ></video>
                    <canvas id="qr-canvas" class="hidden"></canvas>
                    
                    <!-- Scanning Frame -->
                    <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div class="w-48 h-48 sm:w-64 sm:h-64 border-4 border-white border-dashed rounded-2xl animate-pulse"></div>
                    </div>
                    
                    <!-- Scanning Indicator -->
                    {#if videoStream && !scanning}
                        <div class="absolute top-3 left-3 sm:top-4 sm:left-4 bg-green-500 px-3 py-1.5 sm:px-4 sm:py-2 rounded-full flex items-center gap-2 animate-pulse shadow-lg">
                            <div class="w-2 h-2 bg-white rounded-full"></div>
                            <span class="text-white text-xs sm:text-sm font-semibold">Scanning...</span>
                        </div>
                    {/if}
                    
                    <!-- Loading State -->
                    {#if !videoStream}
                        <div class="absolute inset-0 flex items-center justify-center bg-gray-900 bg-opacity-75">
                            <div class="text-center text-white">
                                <Camera class="w-10 h-10 sm:w-12 sm:h-12 mx-auto mb-3 animate-pulse" />
                                <p class="text-sm sm:text-base">Initializing camera...</p>
                            </div>
                        </div>
                    {/if}
                </div>
                
                <!-- Instructions -->
                <p class="text-xs sm:text-sm text-gray-600 text-center mt-3 sm:mt-4 px-2">
                    <Camera class="w-4 h-4 inline mr-1" />
                    Position QR code within the white dashed frame
                </p>
                
                <!-- Error Message if shown -->
                {#if scanMessage.text && scanMessage.type === 'error'}
                    <div class="mt-3 sm:mt-4 p-3 sm:p-4 rounded-lg bg-red-50 text-red-700 border border-red-200 text-xs sm:text-sm">
                        <div class="flex items-start gap-2">
                            <XCircle class="w-5 h-5 flex-shrink-0 mt-0.5" />
                            <span>{scanMessage.text}</span>
                        </div>
                    </div>
                {/if}
                
                <!-- Close Button (Mobile) -->
                <button 
                    on:click={closeScanner}
                    class="mt-4 sm:hidden w-full px-4 py-3 bg-gray-200 text-gray-700 font-semibold rounded-xl hover:bg-gray-300 active:bg-gray-400 transition duration-150 touch-manipulation"
                >
                    Close Scanner
                </button>
            </div>
        </div>
    </div>
{/if}