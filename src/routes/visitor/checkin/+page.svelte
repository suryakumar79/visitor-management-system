<script>
    import { onMount } from 'svelte';
    import { page } from '$app/stores';
    import { goto } from '$app/navigation';
    import { visitorService } from '$lib/visitorService';
    import { Camera, RefreshCcw, User, Mail, Building, Phone, Users, ArrowRight, Edit2, Check, X as XIcon, RotateCw } from 'lucide-svelte';
    
    import Webcam from '$lib/Camera.svelte'; 

    // ✅ OPTIMIZED: Declare state variables at top level (NO browser code here)
    let visitorPhone = '';
    let visitorData = null; 
    let name = '';
    let email = '';
    let companyName = '';
    let totalMembers = 1;
    let message = { text: '', type: '' };
    let submitting = false;
    let webcamRef; 
    let imageDataUrl = ''; 
    let imageFile = null; 
    let showWebcam = false;
    let rotationAngle = 0;
    let isEditingName = false;
    let isEditingEmail = false;
    let isEditingCompany = false;
    let updating = false;
    let updateTimeout;

    function setMessage(text, type = 'error') {
        message = { text, type };
        setTimeout(() => message = { text: '', type: '' }, 7000);
    }

    // ✅ OPTIMIZED: ALL browser code moved to onMount
    onMount(async () => {
        // Session validation
        const sessionStr = sessionStorage.getItem('visitor_otp_session');
        if (!sessionStr) {
            goto('/visitor/login');
            return;
        }

        try {
            const session = JSON.parse(sessionStr);
            if (Date.now() >= session.expiresAt) {
                sessionStorage.removeItem('visitor_otp_session');
                goto('/visitor/login');
                return;
            }

            const urlPhone = $page.url.searchParams.get('phone');
            if (urlPhone && session.phone !== urlPhone) {
                goto('/visitor/login');
                return;
            }

            // Set phone from URL or session
            visitorPhone = urlPhone || session.phone;

        } catch (error) {
            sessionStorage.removeItem('visitor_otp_session');
            goto('/visitor/login');
            return;
        }

        // Load visitor data
        submitting = true;
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);

            const response = await visitorService.getVisitorData(visitorPhone);
            clearTimeout(timeoutId);

            if (response.success && response.registered) {
                visitorData = response.visitor;
                name = visitorData.name;
                email = visitorData.email;
                companyName = visitorData.companyName;
            } else {
                setMessage('Visitor data not found. Please register.', 'error');
                goto(`/visitor/register?phone=${visitorPhone}`);
                return;
            }

        } catch (error) {
            console.error('Failed to load data:', error);
            setMessage('Failed to load necessary data. Please try again.', 'error');
        } finally {
            submitting = false;
        }
    });

    // OPTIMIZED: Efficient image processing
    async function takePicture() {
        if (webcamRef) {
            const capturedImage = webcamRef.snap();
            if (capturedImage) {
                imageDataUrl = capturedImage;
                rotationAngle = 0;
                await processImage(capturedImage, rotationAngle);
            } else {
                setMessage('Failed to capture image. Please try again.', 'error');
            }
        }
    }

    async function rotateImage() {
        rotationAngle = (rotationAngle + 90) % 360;
        await processImage(imageDataUrl, rotationAngle);
    }

    async function processImage(dataUrl, rotation = 0) {
        if (!dataUrl) return;

        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d', { 
                    alpha: false,
                    willReadFrequently: false
                });

                const maxWidth = 600;
                const scaleFactor = img.width > maxWidth ? maxWidth / img.width : 1;

                if (rotation === 90 || rotation === 270) {
                    canvas.width = img.height * scaleFactor;
                    canvas.height = img.width * scaleFactor;
                } else {
                    canvas.width = img.width * scaleFactor;
                    canvas.height = img.height * scaleFactor;
                }

                ctx.save();
                ctx.translate(canvas.width / 2, canvas.height / 2);
                ctx.rotate((rotation * Math.PI) / 180);
                
                if (rotation === 90 || rotation === 270) {
                    ctx.drawImage(img, -canvas.height / 2, -canvas.width / 2, canvas.height, canvas.width);
                } else {
                    ctx.drawImage(img, -canvas.width / 2, -canvas.height / 2, canvas.width, canvas.height);
                }
                
                ctx.restore();

                canvas.toBlob(blob => {
                    if (blob) {
                        imageFile = new File([blob], `selfie-${Date.now()}.webp`, { type: 'image/webp' });
                        
                        const reader = new FileReader();
                        reader.onload = (e) => {
                            imageDataUrl = e.target.result;
                            resolve();
                        };
                        reader.onerror = () => {
                            console.error('Failed to read image');
                            resolve();
                        };
                        reader.readAsDataURL(blob);
                        
                        if (!showWebcam) {
                            setMessage(`Selfie ready (${(blob.size / 1024).toFixed(0)}KB)`, 'success');
                        }
                    } else {
                        console.error('Failed to create blob');
                        setMessage('Failed to process image. Please try again.', 'error');
                        resolve();
                    }
                }, 'image/webp', 0.65);
            };
            
            img.onerror = () => {
                console.error('Failed to load image');
                setMessage('Failed to load image. Please try again.', 'error');
                resolve();
            };
            
            img.src = dataUrl;
        });
    }

    function retakePicture() {
        imageDataUrl = '';
        imageFile = null;
        rotationAngle = 0;
        showWebcam = true;
    }

    function confirmPicture() {
        if (imageFile) {
            showWebcam = false;
            setMessage('Selfie ready for upload!', 'success');
        }
    }

    async function updateVisitorInfo(field) {
        if (!visitorData) return;

        updating = true;
        try {
            let valueToUpdate;
            
            if (field === 'name') {
                if (!name.trim()) {
                    setMessage('Name cannot be empty.', 'error');
                    name = visitorData.name;
                    isEditingName = false;
                    return;
                }
                valueToUpdate = name;
            } else if (field === 'email') {
                if (!email.trim() || !email.includes('@')) {
                    setMessage('Please enter a valid email.', 'error');
                    email = visitorData.email;
                    isEditingEmail = false;
                    return;
                }
                valueToUpdate = email;
            } else if (field === 'company') {
                if (!companyName.trim()) {
                    setMessage('Company name cannot be empty.', 'error');
                    companyName = visitorData.companyName;
                    isEditingCompany = false;
                    return;
                }
                valueToUpdate = companyName;
            }

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 8000);

            const response = await visitorService.updateVisitorData(
                visitorPhone,
                field === 'company' ? 'companyName' : field,
                valueToUpdate
            );

            clearTimeout(timeoutId);

            if (response.success) {
                visitorData = { 
                    ...visitorData, 
                    [field === 'company' ? 'companyName' : field]: valueToUpdate 
                };
                
                setMessage(`${field.charAt(0).toUpperCase() + field.slice(1)} updated successfully!`, 'success');
                
                if (field === 'name') isEditingName = false;
                if (field === 'email') isEditingEmail = false;
                if (field === 'company') isEditingCompany = false;
            } else {
                throw new Error(response.message || 'Update failed');
            }

        } catch (error) {
            console.error(`Failed to update ${field}:`, error);
            setMessage(`Failed to update ${field}. Please try again.`, 'error');
            
            if (field === 'name') {
                name = visitorData.name;
                isEditingName = false;
            }
            if (field === 'email') {
                email = visitorData.email;
                isEditingEmail = false;
            }
            if (field === 'company') {
                companyName = visitorData.companyName;
                isEditingCompany = false;
            }
        } finally {
            updating = false;
        }
    }

    function cancelEdit(field) {
        if (field === 'name') {
            name = visitorData.name;
            isEditingName = false;
        }
        if (field === 'email') {
            email = visitorData.email;
            isEditingEmail = false;
        }
        if (field === 'company') {
            companyName = visitorData.companyName;
            isEditingCompany = false;
        }
    }

    async function handleNext() {
        if (!name || !email || !companyName || !totalMembers) {
            setMessage('Please fill in all mandatory fields.', 'error');
            return;
        }

        if (!imageFile) {
            setMessage('Please take a selfie before continuing.', 'error');
            return;
        }

        submitting = true;
        message = { text: '', type: '' };

        let selfieFileId = null;

        try {
            setMessage('Uploading selfie...', 'success');

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000);

            selfieFileId = await visitorService.uploadSelfie(imageFile);
            clearTimeout(timeoutId);

            const page1Data = {
                visitorPhone,
                name,
                email,
                companyName,
                totalMembers: parseInt(totalMembers, 10),
                selfieFileId
            };

            sessionStorage.setItem('visitor_checkin_page1', JSON.stringify(page1Data));

            setMessage('Details saved! Redirecting...', 'success');
            
            goto(`/visitor/checkin-meeting?phone=${visitorPhone}`);

        } catch (error) {
            console.error('Upload failed:', error);
            setMessage(`Upload failed: ${error.message}`, 'error');
            
            if (selfieFileId) {
                await visitorService.deleteSelfie(selfieFileId).catch(err => {
                    console.error('Cleanup failed:', err);
                });
            }
        } finally {
            submitting = false;
        }
    }
</script>

<svelte:head>
    <title>Visitor Check-in - Step 1</title>
</svelte:head>

<div class="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 to-blue-50 p-4 sm:p-6">
    <div class="w-full max-w-2xl bg-white p-8 sm:p-10 rounded-2xl shadow-2xl border border-gray-100">
        
        <div class="flex flex-col items-center mb-8">
            <User class="w-10 h-10 text-indigo-600 mb-3" />
            <h1 class="text-3xl font-bold text-gray-800 tracking-tight">Visitor Check-in</h1>
            <p class="text-gray-500 text-center mt-2">Step 1 of 2: Your Details</p>
        </div>

        {#if message.text}
            <div class="p-4 mb-6 rounded-lg text-sm font-medium {message.type === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-green-50 text-green-700 border border-green-200'}" role="alert">
                {message.text}
            </div>
        {/if}

        <form on:submit|preventDefault={handleNext} class="space-y-6">
            
            <fieldset class="space-y-6 border-t pt-6 border-gray-200">
                <legend class="text-xl font-semibold text-gray-800 mb-4">Your Details</legend>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label for="name" class="block text-sm font-semibold text-gray-700 mb-2">Your Name *</label>
                        <div class="relative">
                            <User class="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                            <input 
                                id="name" 
                                type="text" 
                                bind:value={name} 
                                placeholder="Your Full Name" 
                                required 
                                class="pl-11 pr-20 w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition {isEditingName ? '' : 'bg-gray-50'}" 
                                disabled={submitting || updating}
                                readonly={!isEditingName}
                            />
                            {#if !isEditingName}
                                <button 
                                    type="button" 
                                    on:click={() => isEditingName = true} 
                                    class="absolute right-3 top-1/2 transform -translate-y-1/2 p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                                    disabled={submitting || updating}
                                    title="Edit name"
                                >
                                    <Edit2 class="w-4 h-4" />
                                </button>
                            {:else}
                                <div class="absolute right-2 top-1/2 transform -translate-y-1/2 flex gap-1">
                                    <button 
                                        type="button" 
                                        on:click={() => updateVisitorInfo('name')} 
                                        class="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                                        disabled={updating}
                                        title="Save changes"
                                    >
                                        <Check class="w-4 h-4" />
                                    </button>
                                    <button 
                                        type="button" 
                                        on:click={() => cancelEdit('name')} 
                                        class="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                        disabled={updating}
                                        title="Cancel"
                                    >
                                        <XIcon class="w-4 h-4" />
                                    </button>
                                </div>
                            {/if}
                        </div>
                    </div>
                    
                    <div>
                        <label for="email" class="block text-sm font-semibold text-gray-700 mb-2">Email *</label>
                        <div class="relative">
                            <Mail class="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                            <input 
                                id="email" 
                                type="email" 
                                bind:value={email} 
                                placeholder="your@email.com" 
                                required 
                                class="pl-11 pr-20 w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition {isEditingEmail ? '' : 'bg-gray-50'}" 
                                disabled={submitting || updating}
                                readonly={!isEditingEmail}
                            />
                            {#if !isEditingEmail}
                                <button 
                                    type="button" 
                                    on:click={() => isEditingEmail = true} 
                                    class="absolute right-3 top-1/2 transform -translate-y-1/2 p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                                    disabled={submitting || updating}
                                    title="Edit email"
                                >
                                    <Edit2 class="w-4 h-4" />
                                </button>
                            {:else}
                                <div class="absolute right-2 top-1/2 transform -translate-y-1/2 flex gap-1">
                                    <button 
                                        type="button" 
                                        on:click={() => updateVisitorInfo('email')} 
                                        class="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                                        disabled={updating}
                                        title="Save changes"
                                    >
                                        <Check class="w-4 h-4" />
                                    </button>
                                    <button 
                                        type="button" 
                                        on:click={() => cancelEdit('email')} 
                                        class="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                        disabled={updating}
                                        title="Cancel"
                                    >
                                        <XIcon class="w-4 h-4" />
                                    </button>
                                </div>
                            {/if}
                        </div>
                    </div>
                    
                    <div class="md:col-span-2">
                        <label for="companyName" class="block text-sm font-semibold text-gray-700 mb-2">Company Name *</label>
                        <div class="relative">
                            <Building class="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                            <input 
                                id="companyName" 
                                type="text" 
                                bind:value={companyName} 
                                placeholder="Your Company" 
                                required 
                                class="pl-11 pr-20 w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition {isEditingCompany ? '' : 'bg-gray-50'}" 
                                disabled={submitting || updating}
                                readonly={!isEditingCompany}
                            />
                            {#if !isEditingCompany}
                                <button 
                                    type="button" 
                                    on:click={() => isEditingCompany = true} 
                                    class="absolute right-3 top-1/2 transform -translate-y-1/2 p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                                    disabled={submitting || updating}
                                    title="Edit company name"
                                >
                                    <Edit2 class="w-4 h-4" />
                                </button>
                            {:else}
                                <div class="absolute right-2 top-1/2 transform -translate-y-1/2 flex gap-1">
                                    <button 
                                        type="button" 
                                        on:click={() => updateVisitorInfo('company')} 
                                        class="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                                        disabled={updating}
                                        title="Save changes"
                                    >
                                        <Check class="w-4 h-4" />
                                    </button>
                                    <button 
                                        type="button" 
                                        on:click={() => cancelEdit('company')} 
                                        class="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                        disabled={updating}
                                        title="Cancel"
                                    >
                                        <XIcon class="w-4 h-4" />
                                    </button>
                                </div>
                            {/if}
                        </div>
                    </div>
                    
                    <div class="md:col-span-2">
                        <label for="visitorPhone" class="block text-sm font-semibold text-gray-700 mb-2">Mobile Number</label>
                        <div class="relative">
                            <Phone class="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                            <input id="visitorPhone" type="tel" value={visitorPhone} class="pl-11 w-full p-3 border border-gray-300 bg-gray-100 rounded-xl text-gray-600 cursor-not-allowed" readonly disabled />
                        </div>
                    </div>
                </div>
            </fieldset>

            <fieldset class="space-y-6 border-t pt-6 border-gray-200">
                <legend class="text-xl font-semibold text-gray-800 mb-4">Final Checks</legend>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label for="totalMembers" class="block text-sm font-semibold text-gray-700 mb-2">Total Members *</label>
                        <div class="relative">
                            <Users class="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                            <select id="totalMembers" bind:value={totalMembers} class="pl-11 w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition" required disabled={submitting}>
                                <option value={1}>1 Member</option>
                                <option value={2}>2 Members</option>
                                <option value={3}>3 Members</option>
                                <option value={4}>4 Members</option>
                                <option value={5}>5 Members</option>
                            </select>
                        </div>
                    </div>
                    
                    <div>
                        <label class="block text-sm font-semibold text-gray-700 mb-2">
                            {totalMembers > 1 ? 'Group Selfie' : 'Selfie'} *
                        </label>
                        {#if !showWebcam && !imageFile}
                            <button type="button" on:click={() => showWebcam = true} class="w-full flex items-center justify-center py-3 px-4 bg-purple-600 text-white font-bold rounded-xl shadow-lg hover:bg-purple-700 transition duration-300" disabled={submitting}>
                                <Camera class="w-5 h-5 mr-2" />
                                Take {totalMembers > 1 ? 'Group ' : ''}Selfie
                            </button>
                        {:else if showWebcam && !imageFile}
                            <div class="relative bg-gray-800 rounded-xl overflow-hidden shadow-inner" style="height: 300px;">
                                <Webcam bind:this={webcamRef} options={{ video: true, audio: false }} class="w-full h-full object-cover rounded-xl" />
                                <div class="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-gray-900 to-transparent flex justify-center space-x-3">
                                    <button type="button" on:click={takePicture} class="flex items-center justify-center p-3 bg-indigo-500 text-white rounded-full hover:bg-indigo-600 transition-colors shadow-lg">
                                        <Camera class="w-6 h-6" />
                                    </button>
                                    <button type="button" on:click={() => showWebcam = false} class="flex items-center justify-center p-3 bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors shadow-lg">
                                        <XIcon class="w-6 h-6" />
                                    </button>
                                </div>
                            </div>
                        {:else if imageFile && showWebcam}
                            <div class="relative border-2 border-dashed border-gray-300 rounded-xl p-4 flex flex-col items-center bg-gray-50">
                                <div class="mb-3 max-h-48 overflow-hidden rounded-lg">
                                    <img src={imageDataUrl} alt="Selfie Preview" class="max-w-full h-auto" />
                                </div>
                                <div class="flex gap-2 flex-wrap justify-center">
                                    <button type="button" on:click={rotateImage} class="flex items-center py-2 px-4 text-sm bg-blue-100 text-blue-700 border border-blue-300 rounded-full hover:bg-blue-200 transition duration-150" disabled={submitting}>
                                        <RotateCw class="w-4 h-4 mr-2" />
                                        Rotate
                                    </button>
                                    <button type="button" on:click={confirmPicture} class="flex items-center py-2 px-4 text-sm bg-green-100 text-green-700 border border-green-300 rounded-full hover:bg-green-200 transition duration-150" disabled={submitting}>
                                        <Check class="w-4 h-4 mr-2" />
                                        Confirm
                                    </button>
                                    <button type="button" on:click={retakePicture} class="flex items-center py-2 px-4 text-sm bg-gray-100 text-gray-700 border border-gray-300 rounded-full hover:bg-gray-200 transition duration-150" disabled={submitting}>
                                        <RefreshCcw class="w-4 h-4 mr-2" />
                                        Retake
                                    </button>
                                </div>
                            </div>
                        {:else if imageFile && !showWebcam}
                            <div class="relative border-2 border-dashed border-green-300 rounded-xl p-4 flex flex-col items-center bg-green-50">
                                <div class="mb-3 max-h-32 overflow-hidden rounded-lg">
                                    <img src={imageDataUrl} alt="Selfie Preview" class="max-w-full h-auto" />
                                </div>
                                <p class="text-sm text-green-700 font-semibold mb-2">✓ Selfie ready</p>
                                <button type="button" on:click={retakePicture} class="flex items-center py-2 px-4 text-sm bg-gray-100 text-gray-700 border border-gray-300 rounded-full hover:bg-gray-200 transition duration-150" disabled={submitting}>
                                    <RefreshCcw class="w-4 h-4 mr-2" />
                                    Retake
                                </button>
                            </div>
                        {/if}
                    </div>
                </div>
            </fieldset>
            
            <button
                type="submit"
                class="w-full py-3 px-4 bg-indigo-600 text-white font-bold rounded-xl shadow-lg hover:bg-indigo-700 transition duration-300 transform hover:scale-[1.005] active:scale-[0.99] flex items-center justify-center space-x-2 disabled:opacity-70 disabled:cursor-not-allowed"
                disabled={submitting || !imageFile}
            >
                {#if submitting}
                    <RefreshCcw class="w-5 h-5 animate-spin" /><span>Processing...</span>
                {:else}
                    <span>Next: Meeting Details</span><ArrowRight class="w-5 h-5" />
                {/if}
            </button>
        </form>
    </div>
</div>