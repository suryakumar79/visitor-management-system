<script>
  import { onMount } from 'svelte';
  import { 
    databases, 
    functions,
    VMS_DATABASE_ID, 
    SYSTEM_SETTINGS_COLLECTION_ID,
    TEST_SETTINGS_FUNCTION_ID,
    Query,
    ID
  } from '$lib/client';
  
  // State variables
  let settings = [];
  let loading = true;
  let saving = false;
  let testingEmail = false;
  let message = null;
  let showPassword = {};
  let editedValues = {};

  onMount(() => {
    loadSettings();
  });

  async function loadSettings() {
    try {
      loading = true;
      const response = await databases.listDocuments(
        VMS_DATABASE_ID,
        SYSTEM_SETTINGS_COLLECTION_ID,
        [Query.orderAsc('category'), Query.limit(100)]
      );
      
      settings = response.documents;
      
      // Initialize edited values
      editedValues = {};
      response.documents.forEach(doc => {
        editedValues[doc.$id] = doc.settingValue;
      });
      
      loading = false;
    } catch (error) {
      console.error('Failed to load settings:', error);
      showMessage('Failed to load settings', 'error');
      loading = false;
    }
  }

  function handleValueChange(docId, newValue) {
    editedValues[docId] = newValue;
  }

  async function handleSaveSetting(docId, settingKey) {
    try {
      saving = true;
      
      await databases.updateDocument(
        VMS_DATABASE_ID,
        SYSTEM_SETTINGS_COLLECTION_ID,
        docId,
        {
          settingValue: editedValues[docId],
          updatedAt: new Date().toISOString()
        }
      );

      showMessage(`${settingKey} updated successfully`, 'success');
      await loadSettings();
    } catch (error) {
      console.error('Failed to save setting:', error);
      showMessage(`Failed to update ${settingKey}`, 'error');
    } finally {
      saving = false;
    }
  }

  async function handleSaveAll() {
    try {
      saving = true;
      
      const updatePromises = settings.map(setting => 
        databases.updateDocument(
          VMS_DATABASE_ID,
          SYSTEM_SETTINGS_COLLECTION_ID,
          setting.$id,
          {
            settingValue: editedValues[setting.$id],
            updatedAt: new Date().toISOString()
          }
        )
      );

      await Promise.all(updatePromises);
      showMessage('All settings saved successfully', 'success');
      await loadSettings();
    } catch (error) {
      console.error('Failed to save settings:', error);
      showMessage('Failed to save some settings', 'error');
    } finally {
      saving = false;
    }
  }

  async function testEmailSettings() {
    const testEmail = prompt('Enter email address to send test email:');
    
    if (!testEmail) return;

    try {
      testingEmail = true;
      
      const response = await functions.createExecution(
        TEST_SETTINGS_FUNCTION_ID,
        JSON.stringify({ 
          testType: 'email',
          recipientEmail: testEmail 
        }),
        false
      );

      const result = JSON.parse(response.responseBody);

      if (result.success) {
        showMessage('Test email sent successfully!', 'success');
      } else {
        throw new Error(result.message || 'Email test failed');
      }
    } catch (error) {
      showMessage('Failed to send test email: ' + error.message, 'error');
    } finally {
      testingEmail = false;
    }
  }

  function showMessage(text, type) {
    message = { text, type };
    setTimeout(() => {
      message = null;
    }, 5000);
  }

  function togglePasswordVisibility(docId) {
    showPassword[docId] = !showPassword[docId];
    showPassword = { ...showPassword };
  }

  // Group settings by category
  $: groupedSettings = settings.reduce((acc, setting) => {
    if (!acc[setting.category]) {
      acc[setting.category] = [];
    }
    acc[setting.category].push(setting);
    return acc;
  }, {});
</script>

<div class="min-h-screen bg-gray-50 p-6">
  <div class="max-w-5xl mx-auto">
    <!-- Header -->
    <div class="mb-8">
      <h1 class="text-3xl font-bold text-gray-900 mb-2">System Settings</h1>
      <p class="text-gray-600">Configure e-mail delivery and the pre-booking rules</p>
    </div>

    {#if loading}
      <!-- Loading State -->
      <div class="flex items-center justify-center min-h-[400px]">
        <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    {:else}
      <!-- Message Alert -->
      {#if message}
        <div class="mb-6 p-4 rounded-lg flex items-center gap-3 {message.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}">
          <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            {#if message.type === 'success'}
              <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/>
            {:else}
              <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/>
            {/if}
          </svg>
          <span>{message.text}</span>
        </div>
      {/if}

      <!-- Email Settings -->
      {#if groupedSettings.email}
        <div class="mb-8">
          <div class="flex items-center justify-between mb-4">
            <div class="flex items-center gap-2">
              <svg class="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
              </svg>
              <h2 class="text-xl font-semibold text-gray-800">Email Configuration</h2>
            </div>
            <button
              on:click={testEmailSettings}
              disabled={testingEmail}
              class="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 flex items-center gap-2"
            >
              {#if testingEmail}
                <div class="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
              {:else}
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
                </svg>
              {/if}
              Test Email
            </button>
          </div>
          <div class="space-y-4">
            {#each groupedSettings.email as setting (setting.$id)}
              <div class="bg-white rounded-lg shadow p-6">
                <div class="flex items-start justify-between mb-4">
                  <div class="flex-1">
                    <label class="block text-sm font-semibold text-gray-700 mb-1">
                      {setting.settingKey}
                    </label>
                    <p class="text-xs text-gray-500 mb-3">{setting.description}</p>
                  </div>
                  {#if setting.isEncrypted}
                    <span class="px-2 py-1 bg-yellow-100 text-yellow-800 text-xs rounded">
                      Encrypted
                    </span>
                  {/if}
                </div>

                <div class="flex gap-2">
                  <div class="flex-1 relative">
                    <input
                      type={setting.settingType === 'password' && !showPassword[setting.$id] ? 'password' : 'text'}
                      value={editedValues[setting.$id] || ''}
                      on:input={(e) => handleValueChange(setting.$id, e.target.value)}
                      class="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder={setting.hasValue ? '•••••••• (set, type to replace)' : `Enter ${setting.settingKey}`}
                    />
                    {#if setting.settingType === 'password'}
                      <button
                        on:click={() => togglePasswordVisibility(setting.$id)}
                        class="absolute right-2 top-2 text-gray-500 hover:text-gray-700"
                        type="button"
                      >
                        {#if showPassword[setting.$id]}
                          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"/>
                          </svg>
                        {:else}
                          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>
                          </svg>
                        {/if}
                      </button>
                    {/if}
                  </div>
                  <button
                    on:click={() => handleSaveSetting(setting.$id, setting.settingKey)}
                    disabled={saving}
                    class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                  >
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"/>
                    </svg>
                  </button>
                </div>
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Pre-booking rules -->
      {#if groupedSettings.bookings}
        <div class="mb-8">
          <div class="flex items-center justify-between mb-4">
            <div class="flex items-center gap-2">
              <svg class="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>
              </svg>
              <h2 class="text-xl font-semibold text-gray-800">Pre-booking rules</h2>
            </div>
          </div>
          <div class="space-y-4">
            {#each groupedSettings.bookings as setting (setting.$id)}
              <div class="bg-white rounded-lg shadow p-6">
                <div class="flex items-start justify-between mb-4">
                  <div class="flex-1">
                    <label class="block text-sm font-semibold text-gray-700 mb-1">
                      {setting.settingKey}
                    </label>
                    <p class="text-xs text-gray-500 mb-3">{setting.description}</p>
                  </div>
                  {#if setting.isEncrypted}
                    <span class="px-2 py-1 bg-yellow-100 text-yellow-800 text-xs rounded">
                      Encrypted
                    </span>
                  {/if}
                </div>

                <div class="flex gap-2">
                  <div class="flex-1 relative">
                    <input
                      type={setting.settingType === 'password' && !showPassword[setting.$id] ? 'password' : 'text'}
                      value={editedValues[setting.$id] || ''}
                      on:input={(e) => handleValueChange(setting.$id, e.target.value)}
                      class="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="Enter {setting.settingKey}"
                    />
                    {#if setting.settingType === 'password'}
                      <button
                        on:click={() => togglePasswordVisibility(setting.$id)}
                        class="absolute right-2 top-2 text-gray-500 hover:text-gray-700"
                        type="button"
                      >
                        {#if showPassword[setting.$id]}
                          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"/>
                          </svg>
                        {:else}
                          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>
                          </svg>
                        {/if}
                      </button>
                    {/if}
                  </div>
                  <button
                    on:click={() => handleSaveSetting(setting.$id, setting.settingKey)}
                    disabled={saving}
                    class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                  >
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"/>
                    </svg>
                  </button>
                </div>
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Save All Button -->
      <div class="flex justify-end mt-8">
        <button
          on:click={handleSaveAll}
          disabled={saving}
          class="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2 text-lg font-semibold"
        >
          {#if saving}
            <div class="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
          {:else}
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"/>
            </svg>
          {/if}
          Save All Settings
        </button>
      </div>

      <!-- Help Text -->
      <div class="mt-8 p-4 bg-blue-50 rounded-lg">
        <h3 class="font-semibold text-blue-900 mb-2">Configuration Notes:</h3>
        <ul class="text-sm text-blue-800 space-y-1 list-disc list-inside">
          <li>SMTP settings are required for email notifications</li>
          <li>Without SMTP settings, e-mails are written to the server console instead of being sent</li>
          <li>Use test buttons to verify configurations before going live</li>
          <li>Passwords are stored encrypted and never shown again. Leave a password field empty to keep the current one</li>
          <li>Changes take effect immediately for new requests</li>
        </ul>
      </div>
    {/if}
  </div>
</div>

<style>
  /* Add any custom styles here if needed */
</style>