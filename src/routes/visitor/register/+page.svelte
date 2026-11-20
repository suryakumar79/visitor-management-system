<script>
    import { goto } from '$app/navigation';
    import { page } from '$app/stores';
    import { browser } from '$app/environment';
    import { RefreshCw, CheckCircle, XCircle } from 'lucide-svelte';
    import { visitorService, sessionToken } from '$lib/visitorService';
    import { get } from 'svelte/store';

    export const ssr = false;

    // OPTIMIZED: Early session validation
    let sessionValid = false;
    let sessionPhone = '';
    
    if (browser) {
        const sessionStr = sessionStorage.getItem('visitor_otp_session');
        if (!sessionStr) {
            goto('/visitor/login');
        } else {
            try {
                const session = JSON.parse(sessionStr);
                if (Date.now() >= session.expiresAt) {
                    sessionStorage.removeItem('visitor_otp_session');
                    goto('/visitor/login');
                } else {
                    sessionValid = true;
                    sessionPhone = session.phone;
                }
            } catch {
                sessionStorage.removeItem('visitor_otp_session');
                goto('/visitor/login');
            }
        }
    }

    // Get phone from URL or session
    const queryPhone = $page.url.searchParams.get('phone') || sessionPhone;

    // State
    let visitor = {
        name: '',
        email: '',
        phone: queryPhone,
        companyName: '',
        role: 'Visitor'
    };
    
    let message = { text: '', type: '' };
    let submitting = false;

    // OPTIMIZED: Debounced email validation
    let emailTimeout;
    let emailValid = null;
    
    // OPTIMIZED: Precompiled regex
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const nameRegex = /^[a-zA-Z\s]{2,}$/;

    function setMessage(text, type = 'error') {
        message = { text, type };
        setTimeout(() => message = { text: '', type: '' }, 5000);
    }

    // OPTIMIZED: Debounced email validation
    function validateEmailDebounced(email) {
        clearTimeout(emailTimeout);
        emailTimeout = setTimeout(() => {
            emailValid = emailRegex.test(email);
        }, 300);
    }

    // OPTIMIZED: Quick inline validation
    function quickValidate() {
        if (!visitor.name?.trim() || !visitor.email?.trim() || !visitor.companyName?.trim()) {
            setMessage('Please fill in all mandatory fields (Name, Email, Company Name).', 'error');
            return false;
        }

        if (!nameRegex.test(visitor.name)) {
            setMessage('Please enter a valid name (letters and spaces only, minimum 2 characters).', 'error');
            return false;
        }

        if (!emailRegex.test(visitor.email)) {
            setMessage('Please enter a valid email address.', 'error');
            return false;
        }

        return true;
    }

    async function handleRegistration() {
        if (!quickValidate()) return;

        submitting = true;
        message = { text: '', type: '' };

        try {
            // OPTIMIZED: AbortController for timeout
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);

            const response = await fetch('/api/otp', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    action: 'register',
                    sessionToken: get(sessionToken)?.token,
                    phoneNumber: visitor.phone,
                    name: visitor.name.trim(),
                    email: visitor.email.toLowerCase().trim(),
                    companyName: visitor.companyName.trim(),
                    role: visitor.role
                }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            const result = await response.json();

            if (response.ok) {
                setMessage('✅ Registration successful! Creating session...', 'success');
                
                // OPTIMIZED: Create session in background, navigate immediately
                // session is already active from the OTP login

                // Navigate immediately
                const dest = $page.url.searchParams.get('next') === 'prebook' ? 'prebook' : 'checkin';
                goto(`/visitor/${dest}?phone=${encodeURIComponent(visitor.phone)}`);

            } else {
                setMessage(`Registration failed: ${result.message || 'Unknown error occurred.'}`, 'error');
            }

        } catch (error) {
            if (error.name === 'AbortError') {
                setMessage('Request timed out. Please try again.', 'error');
            } else {
                console.error('Registration failed:', error);
                setMessage(`Registration failed. Please try again.`, 'error');
            }
        } finally {
            submitting = false;
        }
    }

    function handleLogout() {
        visitorService.clearSession();
        sessionStorage.removeItem('visitor_otp_session');
        goto('/visitor/login');
    }

    // OPTIMIZED: Watch email changes
    $: if (visitor.email) {
        validateEmailDebounced(visitor.email);
    }
</script>

<svelte:head>
    <title>Visitor Registration</title>
</svelte:head>

<div class="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 to-blue-50 p-4">
    <div class="w-full max-w-lg bg-white p-8 rounded-2xl shadow-2xl border-t-8 border-green-600">
        <h1 class="text-3xl font-extrabold text-gray-800 text-center mb-3">New Visitor Registration</h1>
        <p class="text-gray-500 text-center mb-8">Complete your profile to continue</p>

        {#if message.text}
            <div class="p-3 mb-4 rounded-lg text-sm font-medium flex items-start gap-2 {message.type === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-green-50 text-green-700 border border-green-200'}" role="alert">
                {#if message.type === 'error'}
                    <XCircle class="w-5 h-5 mt-0.5 flex-shrink-0" />
                {:else}
                    <CheckCircle class="w-5 h-5 mt-0.5 flex-shrink-0" />
                {/if}
                <span>{message.text}</span>
            </div>
        {/if}

        <form on:submit|preventDefault={handleRegistration} class="space-y-4">
            
            <div>
                <label for="phone" class="block text-sm font-medium text-gray-700 mb-2">Mobile Number (Verified)</label>
                <input
                    id="phone"
                    type="tel"
                    bind:value={visitor.phone}
                    class="w-full p-3 border border-gray-300 rounded-lg bg-gray-50 cursor-not-allowed"
                    readonly
                    disabled
                />
            </div>
            
            <div>
                <label for="name" class="block text-sm font-medium text-gray-700 mb-2">Full Name *</label>
                <input
                    id="name"
                    type="text"
                    bind:value={visitor.name}
                    placeholder="Enter your full name"
                    required
                    class="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 transition"
                    disabled={submitting}
                    autocomplete="name"
                />
            </div>
            
            <div>
                <label for="email" class="block text-sm font-medium text-gray-700 mb-2">Email Address *</label>
                <div class="relative">
                    <input
                        id="email"
                        type="email"
                        bind:value={visitor.email}
                        placeholder="Enter your email"
                        required
                        class="w-full p-3 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 transition"
                        disabled={submitting}
                        autocomplete="email"
                    />
                    {#if emailValid === true}
                        <CheckCircle class="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-green-500" />
                    {:else if emailValid === false}
                        <XCircle class="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-red-500" />
                    {/if}
                </div>
            </div>

            <div>
                <label for="companyName" class="block text-sm font-medium text-gray-700 mb-2">Company Name *</label>
                <input
                    id="companyName"
                    type="text"
                    bind:value={visitor.companyName}
                    placeholder="Enter your company name"
                    required
                    class="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 transition"
                    disabled={submitting}
                    autocomplete="organization"
                />
            </div>

            <button
                type="submit"
                class="w-full py-3 px-4 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 transition duration-150 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                disabled={submitting}
            >
                {#if submitting}
                    <RefreshCw class="w-4 h-4 mr-2 animate-spin" />
                    Registering...
                {:else}
                    Complete Registration & Check-in
                {/if}
            </button>
        </form>

        <button
            on:click={handleLogout}
            class="mt-4 w-full text-sm text-gray-500 hover:text-green-600 transition"
        >
            Back to Login
        </button>
    </div>
</div>