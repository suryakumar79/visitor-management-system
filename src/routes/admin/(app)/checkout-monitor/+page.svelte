<script>
    import { onMount } from 'svelte';
    import { 
        databases,
        Query,
        VMS_DATABASE_ID
    } from '$lib/client';
    import { 
        Mail, 
        Plus, 
        Trash2, 
        X,
        CheckCircle,
        AlertCircle,
        RefreshCw,
        FileSpreadsheet
    } from 'lucide-svelte';

    // Collection ID for email recipients - UPDATE THIS
    const EMAIL_RECIPIENTS_COLLECTION_ID = 'email_recipients'; // You'll need to create this collection

    // State
    let recipients = [];
    let emailInput = '';
    let nameInput = '';
    let includeCSV = true; // Default to including CSV
    let loading = false;
    let saving = false;
    let showToast = false;
    let toastMessage = '';
    let toastType = 'success';

    // Email validation
    function isValidEmail(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }

    // Fetch recipients from database
    async function fetchRecipients() {
        loading = true;
        try {
            const result = await databases.listDocuments(
                VMS_DATABASE_ID,
                EMAIL_RECIPIENTS_COLLECTION_ID,
                [
                    Query.orderAsc('name'),
                    Query.limit(100)
                ]
            );

            recipients = result.documents;
            displayToast(`Loaded ${recipients.length} recipient(s)`, 'success');
        } catch (error) {
            console.error('Error fetching recipients:', error);
            displayToast('Failed to load recipients', 'error');
        } finally {
            loading = false;
        }
    }

    // Add new recipient
    async function addRecipient() {
        const email = emailInput.trim().toLowerCase();
        const name = nameInput.trim();

        if (!email) {
            displayToast('Please enter an email address', 'warning');
            return;
        }

        if (!isValidEmail(email)) {
            displayToast('Please enter a valid email address', 'error');
            return;
        }

        if (!name) {
            displayToast('Please enter a recipient name', 'warning');
            return;
        }

        // Check if email already exists
        const exists = recipients.find(r => r.email.toLowerCase() === email);
        if (exists) {
            displayToast('Email already exists', 'warning');
            return;
        }

        saving = true;
        try {
            const newRecipient = await databases.createDocument(
                VMS_DATABASE_ID,
                EMAIL_RECIPIENTS_COLLECTION_ID,
                'unique()',
                {
                    email: email,
                    name: name,
                    isActive: true,
                    includeCSV: includeCSV,
                    category: 'daily-report',
                    addedAt: new Date().toISOString(),
                    addedBy: 'Admin' // You can get this from auth context
                }
            );

            recipients = [...recipients, newRecipient];
            emailInput = '';
            nameInput = '';
            includeCSV = true; // Reset to default
            displayToast('Recipient added successfully', 'success');
        } catch (error) {
            console.error('Error adding recipient:', error);
            displayToast('Failed to add recipient', 'error');
        } finally {
            saving = false;
        }
    }

    // Toggle recipient active status
    async function toggleRecipient(recipientId, currentStatus) {
        try {
            await databases.updateDocument(
                VMS_DATABASE_ID,
                EMAIL_RECIPIENTS_COLLECTION_ID,
                recipientId,
                {
                    isActive: !currentStatus
                }
            );

            // Update local state
            recipients = recipients.map(r => 
                r.$id === recipientId ? { ...r, isActive: !currentStatus } : r
            );

            displayToast(
                !currentStatus ? 'Recipient activated' : 'Recipient deactivated',
                'success'
            );
        } catch (error) {
            console.error('Error toggling recipient:', error);
            displayToast('Failed to update recipient', 'error');
        }
    }

    // Toggle CSV option for recipient
    async function toggleCSV(recipientId, currentCSVStatus) {
        try {
            await databases.updateDocument(
                VMS_DATABASE_ID,
                EMAIL_RECIPIENTS_COLLECTION_ID,
                recipientId,
                {
                    includeCSV: !currentCSVStatus
                }
            );

            // Update local state
            recipients = recipients.map(r => 
                r.$id === recipientId ? { ...r, includeCSV: !currentCSVStatus } : r
            );

            displayToast(
                !currentCSVStatus ? 'CSV enabled for this recipient' : 'CSV disabled for this recipient',
                'success'
            );
        } catch (error) {
            console.error('Error toggling CSV:', error);
            displayToast('Failed to update CSV option', 'error');
        }
    }

    // Delete recipient
    async function deleteRecipient(recipientId) {
        if (!confirm('Are you sure you want to delete this recipient?')) {
            return;
        }

        try {
            await databases.deleteDocument(
                VMS_DATABASE_ID,
                EMAIL_RECIPIENTS_COLLECTION_ID,
                recipientId
            );

            recipients = recipients.filter(r => r.$id !== recipientId);
            displayToast('Recipient deleted successfully', 'success');
        } catch (error) {
            console.error('Error deleting recipient:', error);
            displayToast('Failed to delete recipient', 'error');
        }
    }

    // Toast notification
    function displayToast(message, type = 'success') {
        toastMessage = message;
        toastType = type;
        showToast = true;

        setTimeout(() => {
            showToast = false;
        }, 3000);
    }

    // Format date
    function formatDate(dateString) {
        if (!dateString) return '-';
        return new Date(dateString).toLocaleDateString('en-IN', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    onMount(() => {
        fetchRecipients();
    });
</script>

<svelte:head>
    <title>Email Recipients - VMS</title>
</svelte:head>

<div class="p-6 bg-gray-50 min-h-screen">
    <!-- Header -->
    <div class="mb-6">
        <h1 class="text-3xl font-bold text-gray-800 flex items-center gap-3">
            <Mail class="w-8 h-8 text-blue-600" />
            Daily Report Email Recipients
        </h1>
        <p class="text-gray-600 mt-1">Manage who receives automated daily checkout reports at 11:50 PM</p>
    </div>

    <!-- Add Recipient Form -->
    <div class="bg-white rounded-lg shadow-md p-6 mb-6 border-l-4 border-blue-500">
        <h2 class="text-xl font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <Plus class="w-5 h-5" />
            Add New Recipient
        </h2>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <!-- Name Input -->
            <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                    Name *
                </label>
                <input
                    type="text"
                    bind:value={nameInput}
                    placeholder="e.g., Admin, Security Team"
                    class="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                />
            </div>

            <!-- Email Input -->
            <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                    Email Address *
                </label>
                <input
                    type="email"
                    bind:value={emailInput}
                    on:keypress={(e) => e.key === 'Enter' && addRecipient()}
                    placeholder="name@example.com"
                    class="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                />
            </div>

            <!-- CSV Checkbox -->
            <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                    CSV Attachment
                </label>
                <label class="flex items-center gap-3 p-3 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 transition">
                    <input
                        type="checkbox"
                        bind:checked={includeCSV}
                        class="w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                    />
                    <div class="flex items-center gap-2">
                        <FileSpreadsheet class="w-4 h-4 text-green-600" />
                        <span class="text-sm text-gray-700">Include CSV file</span>
                    </div>
                </label>
            </div>
        </div>

        <!-- Add Button - Full Width on New Row -->
        <div class="mt-4">
            <button
                on:click={addRecipient}
                disabled={saving}
                class="w-full md:w-auto px-8 py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-lg hover:from-blue-700 hover:to-blue-800 transition flex items-center justify-center gap-2 font-medium shadow-sm hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
            >
                {#if saving}
                    <RefreshCw class="w-4 h-4 animate-spin" />
                    Adding...
                {:else}
                    <Plus class="w-4 h-4" />
                    Add Recipient
                {/if}
            </button>
        </div>

        <p class="text-sm text-gray-500 mt-3">
            <strong>Note:</strong> Added recipients will automatically receive daily checkout reports at 11:50 PM IST. 
            CSV attachment will only be sent to recipients with the checkbox enabled.
        </p>
    </div>

    <!-- Recipients List -->
    <div class="bg-white rounded-lg shadow-md overflow-hidden">
        <div class="bg-gray-50 px-6 py-4 border-b border-gray-200 flex items-center justify-between">
            <h2 class="text-lg font-semibold text-gray-800">
                Active Recipients
            </h2>
            <div class="flex items-center gap-4">
                <span class="text-sm text-gray-600 font-medium">
                    {recipients.filter(r => r.isActive).length} active / {recipients.length} total
                </span>
                <button
                    on:click={fetchRecipients}
                    disabled={loading}
                    class="text-blue-600 hover:text-blue-700 transition"
                >
                    <RefreshCw class="w-5 h-5 {loading ? 'animate-spin' : ''}" />
                </button>
            </div>
        </div>

        {#if loading}
            <div class="flex justify-center items-center h-64">
                <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            </div>
        {:else if recipients.length === 0}
            <div class="text-center py-12">
                <Mail class="w-16 h-16 text-gray-300 mx-auto mb-4" />
                <p class="text-gray-500">No recipients added yet</p>
                <p class="text-sm text-gray-400 mt-1">Add your first recipient above to start receiving daily reports</p>
            </div>
        {:else}
            <div class="overflow-x-auto">
                <table class="w-full">
                    <thead class="bg-gray-50 border-b border-gray-200">
                        <tr>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
                            <th class="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">CSV Attachment</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Added On</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Added By</th>
                            <th class="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                        </tr>
                    </thead>
                    <tbody class="bg-white divide-y divide-gray-200">
                        {#each recipients as recipient}
                            <tr class="hover:bg-gray-50 transition">
                                <td class="px-6 py-4 whitespace-nowrap">
                                    <button
                                        on:click={() => toggleRecipient(recipient.$id, recipient.isActive)}
                                        class="flex items-center gap-2 text-sm"
                                    >
                                        {#if recipient.isActive}
                                            <span class="px-3 py-1 bg-green-100 text-green-800 rounded-full text-xs font-semibold flex items-center gap-1">
                                                <CheckCircle class="w-3 h-3" />
                                                Active
                                            </span>
                                        {:else}
                                            <span class="px-3 py-1 bg-gray-100 text-gray-600 rounded-full text-xs font-semibold flex items-center gap-1">
                                                <X class="w-3 h-3" />
                                                Inactive
                                            </span>
                                        {/if}
                                    </button>
                                </td>
                                <td class="px-6 py-4 whitespace-nowrap">
                                    <div class="text-sm font-medium text-gray-900">{recipient.name}</div>
                                </td>
                                <td class="px-6 py-4 whitespace-nowrap">
                                    <div class="text-sm text-gray-900">{recipient.email}</div>
                                </td>
                                <td class="px-6 py-4 whitespace-nowrap text-center">
                                    <button
                                        on:click={() => toggleCSV(recipient.$id, recipient.includeCSV)}
                                        class="inline-flex items-center gap-1 px-3 py-1 rounded-lg transition {
                                            recipient.includeCSV 
                                                ? 'bg-green-100 text-green-800 hover:bg-green-200' 
                                                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                        }"
                                    >
                                        <FileSpreadsheet class="w-3 h-3" />
                                        <span class="text-xs font-semibold">
                                            {recipient.includeCSV ? 'Enabled' : 'Disabled'}
                                        </span>
                                    </button>
                                </td>
                                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                    {formatDate(recipient.addedAt)}
                                </td>
                                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                    {recipient.addedBy || 'Unknown'}
                                </td>
                                <td class="px-6 py-4 whitespace-nowrap text-center">
                                    <button
                                        on:click={() => deleteRecipient(recipient.$id)}
                                        class="text-red-600 hover:text-red-800 transition inline-flex items-center gap-1 px-3 py-1 rounded hover:bg-red-50"
                                    >
                                        <Trash2 class="w-4 h-4" />
                                        <span class="text-sm">Delete</span>
                                    </button>
                                </td>
                            </tr>
                        {/each}
                    </tbody>
                </table>
            </div>
        {/if}
    </div>

    <!-- Info Box -->
    <div class="mt-6 bg-blue-50 border-l-4 border-blue-500 p-4 rounded">
        <div class="flex items-start gap-3">
            <AlertCircle class="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
            <div>
                <h3 class="text-sm font-semibold text-blue-900 mb-1">How It Works</h3>
                <ul class="text-sm text-blue-800 space-y-1">
                    <li>• Daily reports are automatically sent at <strong>11:50 PM IST</strong> every day</li>
                    <li>• Only <strong>Active</strong> recipients will receive the emails</li>
                    <li>• Reports include visitor statistics: <strong>Pending, Approved, Checked-In</strong> counts alongside Total Visitors</li>
                    <li>• CSV attachment is sent only to recipients with <strong>"Include CSV file"</strong> enabled</li>
                    <li>• Click on a recipient's status to toggle between Active/Inactive</li>
                    <li>• Click on CSV status to enable/disable CSV attachment for that recipient</li>
                </ul>
            </div>
        </div>
    </div>

    <!-- Email Template Preview -->
    <div class="mt-6 bg-white rounded-lg shadow-md p-6 border-l-4 border-purple-500">
        <h3 class="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <Mail class="w-5 h-5 text-purple-600" />
            Email Template Preview
        </h3>
        
        <div class="bg-gray-50 p-6 rounded-lg border border-gray-200">
            <h4 class="text-xl font-bold text-gray-800 mb-4">Daily Visitor Checkout Report</h4>
            
            <!-- Stats Grid - Compact Layout -->
            <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <!-- Total Visitors -->
                <div class="bg-white p-4 rounded-lg border-l-4 border-blue-500">
                    <p class="text-xs text-gray-600 font-medium uppercase">Total Visitors</p>
                    <p class="text-2xl font-bold text-blue-600">125</p>
                </div>

                <!-- Pending -->
                <div class="bg-white p-4 rounded-lg border-l-4 border-yellow-500">
                    <p class="text-xs text-gray-600 font-medium uppercase">Pending</p>
                    <p class="text-2xl font-bold text-yellow-600">15</p>
                </div>

                <!-- Approved -->
                <div class="bg-white p-4 rounded-lg border-l-4 border-green-500">
                    <p class="text-xs text-gray-600 font-medium uppercase">Approved</p>
                    <p class="text-2xl font-bold text-green-600">30</p>
                </div>

                <!-- Checked In -->
                <div class="bg-white p-4 rounded-lg border-l-4 border-purple-500">
                    <p class="text-xs text-gray-600 font-medium uppercase">Checked In</p>
                    <p class="text-2xl font-bold text-purple-600">80</p>
                </div>
            </div>

            <p class="text-sm text-gray-600 italic">
                * This is a preview of how the email will look. The actual email will contain today's visitor data.
            </p>
            <p class="text-xs text-gray-500 mt-2">
                <strong>CSV Note:</strong> Recipients with CSV enabled will receive an Excel file attachment with detailed visitor information.
            </p>
        </div>
    </div>
</div>

<!-- Toast Notification -->
{#if showToast}
    <div class="fixed bottom-6 right-6 z-50 animate-slide-in-right">
        <div class="bg-white rounded-lg shadow-lg border-l-4 {
            toastType === 'success' ? 'border-green-500' : 
            toastType === 'error' ? 'border-red-500' : 
            'border-orange-500'
        } p-4 max-w-md">
            <div class="flex items-center gap-3">
                {#if toastType === 'success'}
                    <CheckCircle class="w-5 h-5 text-green-500" />
                {:else if toastType === 'error'}
                    <AlertCircle class="w-5 h-5 text-red-500" />
                {:else}
                    <AlertCircle class="w-5 h-5 text-orange-500" />
                {/if}
                <p class="text-sm font-medium text-gray-900">{toastMessage}</p>
            </div>
        </div>
    </div>
{/if}

<style>
    @keyframes slide-in-right {
        from {
            transform: translateX(400px);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }

    .animate-slide-in-right {
        animation: slide-in-right 0.3s ease-out;
    }
</style>