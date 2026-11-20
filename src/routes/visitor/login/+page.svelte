<script>
    import { goto } from '$app/navigation';
    import { RefreshCw, AlertCircle, Clock, CheckCircle, XCircle } from 'lucide-svelte';
    import { otpSession } from '$lib/stores/otpSession';
    import { visitorService, sessionToken } from '$lib/visitorService';
    import { APP_NAME, ORG_NAME } from '$lib/brand.js';

    // State
    let phoneNumber = '';
    let otp = '';
    let step = 'phone'; // 'phone' | 'otp'
    let message = { text: '', type: '' };
    let submitting = false;
    let otpSentTo = '';
    let retryAfter = 0;
    let usageStats = null;
    let resendCountdown = 0;
    let testOtp = ''; // only filled while the server runs in test mode

    // OPTIMIZED: Debounce timer for phone validation
    let validationTimeout;

    // OPTIMIZED: Cached validation results
    let phoneValidationCache = new Map();

    // Utility
    function setMessage(text, type = 'error') {
        message = { text, type };
        setTimeout(() => message = { text: '', type: '' }, 7000); 
    }

    // FIXED: Proper phone validation - requires exactly 10 digits after +91
    function isValidPhoneNumber(phone) {
        if (phoneValidationCache.has(phone)) {
            return phoneValidationCache.get(phone);
        }
        
        const cleaned = phone.replace(/\D/g, '');
        let isValid = false;
        
        if (phone.startsWith('+91')) {
            // Should be +91 followed by exactly 10 digits
            const afterCode = phone.slice(3).replace(/\D/g, '');
            isValid = afterCode.length === 10;
        } else if (cleaned.startsWith('91')) {
            // Should be 91 followed by exactly 10 digits (total 12)
            isValid = cleaned.length === 12;
        } else {
            // Generic validation for other country codes
            isValid = cleaned.length >= 10 && cleaned.length <= 15;
        }
        
        phoneValidationCache.set(phone, isValid);
        return isValid;
    }

    // Format phone number to E.164 format
    function formatPhoneNumber(phone) {
        const cleaned = phone.replace(/\D/g, '');
        if (!phone.startsWith('+')) {
            return `+${cleaned}`;
        }
        return `+${cleaned}`;
    }

    // OPTIMIZED: More efficient phone input handling
    function handlePhoneInput(event) {
        let value = event.target.value;
        
        // Quick return for empty/basic input
        if (!value || value === '+') {
            phoneNumber = '+91';
            return;
        }
        
        // Remove all non-digits except +
        const digitsOnly = value.replace(/[^\d+]/g, '');
        
        // Handle different input scenarios
        if (digitsOnly === '+91' || digitsOnly === '+') {
            phoneNumber = '+91';
        } else if (!digitsOnly.startsWith('+91')) {
            // Auto-prepend +91 if not present
            const cleanDigits = digitsOnly.replace(/^\+?91/, '');
            phoneNumber = '+91' + cleanDigits;
        } else {
            phoneNumber = digitsOnly;
        }
        
        // FIXED: Limit to +91 + 10 digits = 13 characters
        if (phoneNumber.length > 13) {
            phoneNumber = phoneNumber.slice(0, 13);
        }
        
        // OPTIMIZED: Debounced validation
        clearTimeout(validationTimeout);
        validationTimeout = setTimeout(() => {
            isValidPhoneNumber(phoneNumber);
        }, 300);
    }

    // Initialize with +91
    function initializePhone() {
        if (!phoneNumber) {
            phoneNumber = '+91';
        }
    }

    // OPTIMIZED: Single interval for both countdowns
    let countdownInterval;
    
    function startCountdowns(retry = 0, resend = 0) {
        // Clear any existing interval
        if (countdownInterval) {
            clearInterval(countdownInterval);
        }
        
        retryAfter = retry;
        resendCountdown = resend;
        
        if (retry === 0 && resend === 0) return;
        
        countdownInterval = setInterval(() => {
            if (retryAfter > 0) retryAfter--;
            if (resendCountdown > 0) resendCountdown--;
            
            // Clear interval when both reach 0
            if (retryAfter === 0 && resendCountdown === 0) {
                clearInterval(countdownInterval);
            }
        }, 1000);
    }

    // Format time remaining
    function formatTimeRemaining(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
    }

    // OPTIMIZED: Cleanup on destroy
    import { onDestroy } from 'svelte';
    onDestroy(() => {
        if (countdownInterval) clearInterval(countdownInterval);
        if (validationTimeout) clearTimeout(validationTimeout);
    });

    // --- Core Handlers ---

    async function handleSendOtp() {
        const phone = phoneNumber.trim();
        
        // FIXED: Better validation messages
        if (phone === '+91' || phone.replace(/\D/g, '').length <= 2) {
            setMessage('Please enter your mobile number after +91.', 'error');
            return;
        }
        
        // FIXED: Check for exactly 10 digits after +91
        const digitsAfter91 = phone.slice(3).replace(/\D/g, '');
        if (digitsAfter91.length < 10) {
            setMessage(`Please enter a complete 10-digit mobile number. You have entered ${digitsAfter91.length} digit${digitsAfter91.length !== 1 ? 's' : ''}.`, 'error');
            return;
        }
        
        if (!isValidPhoneNumber(phone)) {
            setMessage('Please enter a valid 10-digit mobile number.', 'error');
            return;
        }

        submitting = true;
        message = { text: '', type: '' };

        try {
            const formattedPhone = formatPhoneNumber(phone);

            // OPTIMIZED: Use AbortController for timeout
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

            const response = await fetch('/api/otp', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    action: 'send',
                    phoneNumber: formattedPhone
                }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            const data = await response.json();
            
            if (response.ok) {
                usageStats = data.usageStats;
                
                const statsMsg = usageStats 
                    ? ` (${usageStats.shortTermCount}/${usageStats.shortTermLimit} in 10min, ${usageStats.dailyCount}/${usageStats.dailyLimit} today)`
                    : '';
                    
                testOtp = data.otp || '';
                setMessage(testOtp ? 'OTP generated (test mode)' : 'Verification code sent', 'success');
                otpSentTo = formattedPhone;
                step = 'otp';
                
                startCountdowns(0, testOtp ? 5 : 60);

            } else if (response.status === 429) {
                usageStats = data.usageStats;
                
                let limitMessage = data.message || 'Too many requests. Please wait before trying again.';
                
                if (data.limitType === 'daily') {
                    limitMessage = `⛔ Daily limit reached! You've used all ${usageStats?.dailyLimit || 15} OTPs today. Please try again tomorrow.`;
                } else if (data.limitType === 'shortTerm') {
                    limitMessage = `⏱️ Too many requests! You can only request ${usageStats?.shortTermLimit || 5} OTPs per 10 minutes. Please wait.`;
                } else if (data.limitType === 'cooldown') {
                    limitMessage = data.message;
                }
                
                setMessage(limitMessage, 'error');
                
                if (data.retryAfter) {
                    startCountdowns(data.retryAfter, 0);
                }

            } else {
                setMessage(`Failed to send OTP. ${data.message || 'Unknown error occurred.'}`, 'error');
            }

        } catch (error) {
            if (error.name === 'AbortError') {
                setMessage('Request timed out. Please check your connection and try again.', 'error');
            } else {
                console.error('OTP Send failed:', error);
                setMessage(`Failed to send OTP. Please check your internet connection and try again.`, 'error');
            }
        } finally {
            submitting = false;
        }
    }

    async function handleVerifyOtp() {
        const inputOtp = otp.trim();
        
        // Quick validation
        if (!inputOtp || inputOtp.length !== 4) {
            setMessage('Please enter the 4-digit OTP.', 'error');
            return;
        }

        submitting = true;
        message = { text: '', type: '' };

        try {
            // OPTIMIZED: Timeout for verification
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 20000); // 20s timeout

            const response = await fetch('/api/otp', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    action: 'verify',
                    phoneNumber: otpSentTo,
                    otp: inputOtp
                }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            const data = await response.json();
            
            if (response.ok) {
                setMessage('✅ Verification successful!', 'success');

                // Set OTP session
                otpSession.setSession(otpSentTo);

                // The server issues the visitor session only after the OTP was verified
                sessionToken.set({ token: data.sessionToken, phone: otpSentTo, expiresAt: data.expiresAt });

                const wantsBooking = new URLSearchParams(window.location.search).get('next') === 'prebook';
                const nextQs = wantsBooking ? '&next=prebook' : '';
                const redirectPath = data.isRegistered 
                    ? (wantsBooking
                        ? `/visitor/prebook?phone=${encodeURIComponent(otpSentTo)}`
                        : `/visitor/checkin?phone=${encodeURIComponent(otpSentTo)}`)
                    : `/visitor/register?phone=${encodeURIComponent(otpSentTo)}${nextQs}`;
                
                // Navigate immediately
                goto(redirectPath);

            } else {
                setMessage(`❌ ${data.message || 'Incorrect OTP. Please try again.'}`, 'error');
            }

        } catch (error) {
            if (error.name === 'AbortError') {
                setMessage('Verification timed out. Please try again.', 'error');
            } else {
                console.error('OTP Verify failed:', error);
                setMessage(`Verification failed. Please try again.`, 'error');
            }
        } finally {
            submitting = false;
        }
    }

    // Reset flow
    function resetFlow() {
        step = 'phone';
        otp = '';
        message = { text: '', type: '' };
        phoneNumber = '+91';
        usageStats = null;
        
        // Clear countdowns
        if (countdownInterval) {
            clearInterval(countdownInterval);
        }
        retryAfter = 0;
        resendCountdown = 0;
    }

    // Resend OTP
    async function handleResendOtp() {
        otp = '';
        await handleSendOtp();
    }

    // OPTIMIZED: Auto-focus on OTP input when step changes
    $: if (step === 'otp') {
        setTimeout(() => {
            document.getElementById('otp')?.focus();
        }, 100);
    }
</script>

<svelte:head>
    <title>Visitor Check-in</title>
</svelte:head>

<div class="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 to-blue-50 p-4">
    <div class="w-full max-w-sm">
        <!-- Company Logo and Header -->
        <div class="text-center mb-6">
            <div class="flex items-center justify-center gap-3 mb-2">
                <img src="/logo.svg" alt="" class="w-12 h-12 object-contain" />
                <h2 class="text-xl font-bold text-gray-800">{ORG_NAME || APP_NAME}</h2>
            </div>
            <p class="text-sm text-gray-600 font-medium">{ORG_NAME ? APP_NAME : 'Welcome'}</p>
        </div>

        <!-- Main Card -->
        <div class="bg-white p-8 rounded-2xl shadow-2xl">
            <h1 class="text-2xl font-bold text-center text-gray-800 mb-6">Visitor Check-in</h1>

            <!-- Global Messages -->
            {#if message.text}
                <div class="p-3 mb-4 rounded-lg text-sm flex items-start gap-2 {message.type === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-green-50 text-green-700 border border-green-200'}" role="alert">
                    {#if message.type === 'error'}
                        <XCircle class="w-5 h-5 mt-0.5 flex-shrink-0" />
                    {:else}
                        <CheckCircle class="w-5 h-5 mt-0.5 flex-shrink-0" />
                    {/if}
                    <span>{message.text}</span>
                </div>
            {/if}

            <!-- Usage Stats Display -->
            {#if usageStats && step === 'phone'}
                <div class="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <div class="flex items-start gap-2">
                        <Clock class="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
                        <div class="text-sm text-blue-800">
                            <p class="font-medium mb-1">OTP Usage:</p>
                            <p>Last 10 min: <strong>{usageStats.shortTermCount}/{usageStats.shortTermLimit}</strong></p>
                            <p>Today: <strong>{usageStats.dailyCount}/{usageStats.dailyLimit}</strong></p>
                            {#if usageStats.dailyCount >= usageStats.dailyLimit * 0.8}
                                <p class="text-orange-600 mt-1 font-medium">⚠️ Approaching daily limit!</p>
                            {/if}
                        </div>
                    </div>
                </div>
            {/if}

            {#if step === 'phone'}
                <!-- Step 1: Phone Number Input -->
                
                {#if resendCountdown > 0}
                    <div class="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg">
                        <div class="flex items-start gap-2">
                            <Clock class="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                            <div class="text-sm text-green-800">
                                <p class="font-medium">OTP Already Sent!</p>
                                <p>Request new OTP in <strong>{resendCountdown}s</strong></p>
                            </div>
                        </div>
                    </div>
                {/if}
                
                <form on:submit|preventDefault={handleSendOtp} class="space-y-4">
                    <div>
                        <label for="phone" class="block text-sm font-medium text-gray-700 mb-2">Mobile Number</label>
                        <input
                            id="phone"
                            type="tel"
                            bind:value={phoneNumber}
                            on:input={handlePhoneInput}
                            on:focus={initializePhone}
                            placeholder="+919876543210"
                            required
                            class="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
                            disabled={submitting || retryAfter > 0}
                            maxlength="13"
                            autocomplete="tel"
                        />
                        <p class="text-xs text-gray-500 mt-1">Enter your 10-digit mobile number (India +91)</p>
                    </div>
                    <button
                        type="submit"
                        class="w-full py-3 px-4 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 transition duration-150 disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center"
                        disabled={submitting || retryAfter > 0 || resendCountdown > 0}
                    >
                        {#if submitting}
                            <RefreshCw class="w-4 h-4 mr-2 animate-spin" />
                            Sending OTP...
                        {:else if resendCountdown > 0}
                            <Clock class="w-4 h-4 mr-2" />
                            Wait {resendCountdown}s
                        {:else if retryAfter > 0}
                            <Clock class="w-4 h-4 mr-2" />
                            Wait {formatTimeRemaining(retryAfter)}
                        {:else}
                            Send Verification Code
                        {/if}
                    </button>
                    
                    {#if retryAfter > 0}
                        <p class="text-xs text-center text-gray-600">
                            Rate limit: Please wait before requesting another OTP
                        </p>
                    {:else if resendCountdown > 0}
                        <p class="text-xs text-center text-gray-600">
                            OTP sent! New request available in {resendCountdown} seconds
                        </p>
                    {/if}
                </form>
            {:else if step === 'otp'}
                <!-- Step 2: OTP Verification -->
                <form on:submit|preventDefault={handleVerifyOtp} class="space-y-4">
                     <p class="text-sm text-center text-gray-600 mb-4">
                        Enter the code sent to <strong class="text-indigo-600">{otpSentTo}</strong> by message.
                     </p>
                    {#if testOtp}
                        <div class="rounded-lg border-2 border-dashed border-amber-400 bg-amber-50 p-3 text-center" data-testid="test-otp">
                            <p class="text-xs font-semibold uppercase tracking-wide text-amber-700">Test mode – your OTP</p>
                            <p class="text-3xl font-bold tracking-[0.5em] text-amber-900 my-1">{testOtp}</p>
                            <button type="button" class="text-xs font-medium text-amber-800 underline" on:click={() => (otp = testOtp)}>
                                Fill it in for me
                            </button>
                        </div>
                    {/if}
                    <div>
                        <label for="otp" class="block text-sm font-medium text-gray-700 mb-2">Enter OTP</label>
                        <input
                            id="otp"
                            type="text"
                            inputmode="numeric"
                            autocomplete="one-time-code"
                            bind:value={otp}
                            placeholder="0000"
                            required
                            class="w-full p-3 text-2xl text-center tracking-widest border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 transition"
                            disabled={submitting}
                            maxlength="4"
                        />
                    </div>
                    <button
                        type="submit"
                        class="w-full py-3 px-4 bg-green-600 text-white font-medium rounded-lg hover:bg-green-700 transition duration-150 disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center"
                        disabled={submitting}
                    >
                        {#if submitting}
                            <RefreshCw class="w-4 h-4 mr-2 animate-spin" />
                            Verifying...
                        {:else}
                            Verify Code & Continue
                        {/if}
                    </button>
                    
                    <!-- Resend OTP Button -->
                    <button 
                        on:click={handleResendOtp} 
                        type="button" 
                        class="w-full text-sm text-indigo-600 hover:text-indigo-800 mt-2 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={submitting || retryAfter > 0 || resendCountdown > 0}
                    >
                        {#if resendCountdown > 0}
                            Resend OTP in {resendCountdown}s
                        {:else if retryAfter > 0}
                            Resend OTP in {formatTimeRemaining(retryAfter)}
                        {:else}
                            Resend OTP
                        {/if}
                    </button>

                    <button 
                        on:click={resetFlow} 
                        type="button" 
                        class="w-full text-sm text-gray-500 hover:text-indigo-600 mt-2 transition"
                    >
                        Change Mobile Number
                    </button>
                </form>
            {/if}
        </div>

    </div>
</div>