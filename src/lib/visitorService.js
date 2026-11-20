// src/lib/visitorService.js
import { storage, VISITOR_SELFIES_BUCKET_ID, ID } from '$lib/client';
import { writable } from 'svelte/store';

/**
 * Session Token Store
 */
export const sessionToken = writable(null);

// Load session token from localStorage on init (browser only)
if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('visitor_session_token');
    if (stored) {
        try {
            const parsed = JSON.parse(stored);
            if (parsed.expiresAt > Date.now()) {
                sessionToken.set(parsed);
            } else {
                localStorage.removeItem('visitor_session_token');
            }
        } catch {
            localStorage.removeItem('visitor_session_token');
        }
    }
}

// Save session token to localStorage when it changes
sessionToken.subscribe(value => {
    if (typeof window !== 'undefined') {
        if (value) {
            localStorage.setItem('visitor_session_token', JSON.stringify(value));
        } else {
            localStorage.removeItem('visitor_session_token');
        }
    }
});

/**
 * Visitor Service - All operations via SvelteKit API routes
 */
class VisitorService {
    constructor() {
        this.currentToken = null;
        this.currentPhone = null;
        
        sessionToken.subscribe(value => {
            this.currentToken = value?.token || null;
            this.currentPhone = value?.phone || null;
        });
    }

    /**
     * Call API with retry logic
     */
    async callApi(endpoint, data, maxRetries = 3) {
        let lastError;
        
        // Add session token if available
        if (this.currentToken && this.currentPhone && !data.sessionToken) {
            data.sessionToken = this.currentToken;
        }
        
        for (let i = 0; i < maxRetries; i++) {
            try {
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(data)
                });

                const result = await response.json();

                if (response.ok && result.success !== false) {
                    return result;
                } else if (response.status === 401) {
                    // Session expired - clear session
                    sessionToken.set(null);
                    throw new Error(result.message || 'Session expired');
                } else if (response.status === 429) {
                    // Rate limit - don't retry
                    throw new Error(result.message || 'Too many requests');
                } else {
                    throw new Error(result.message || 'API call failed');
                }
            } catch (error) {
                lastError = error;
                
                // Don't retry on rate limit or auth errors
                if (error.message.includes('Too many requests') || 
                    error.message.includes('Session expired') ||
                    error.message.includes('Invalid session')) {
                    throw error;
                }
                
                if (i < maxRetries - 1) {
                    await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
                }
            }
        }
        
        throw lastError;
    }

    /**
     * Create a new session token
     */
    async createSession(phone) {
        try {
            const response = await this.callApi('/api/visitor-operations', {
                action: 'createSession',
                phone
            });

            if (response.success) {
                sessionToken.set({
                    token: response.sessionToken,
                    phone: response.phone,
                    expiresAt: response.expiresAt
                });
                
                return response;
            } else {
                throw new Error(response.message || 'Failed to create session');
            }
        } catch (error) {
            console.error('Failed to create session:', error);
            throw error;
        }
    }

    /**
     * Validate current session
     */
    async validateSession() {
        if (!this.currentToken || !this.currentPhone) {
            return { valid: false, needsLogin: true };
        }

        try {
            const response = await this.callApi('/api/visitor-operations', {
                action: 'validateSession',
                sessionToken: this.currentToken,
                phone: this.currentPhone
            });

            if (!response.success || !response.valid) {
                sessionToken.set(null);
                return { valid: false, needsLogin: true };
            }

            return { valid: true };
        } catch (error) {
            console.error('Session validation failed:', error);
            sessionToken.set(null);
            return { valid: false, needsLogin: true };
        }
    }

    /**
     * Clear session (logout)
     */
    clearSession() {
        sessionToken.set(null);
        this.currentToken = null;
        this.currentPhone = null;
    }

    /**
     * Get visitor data by phone number
     */
    async getVisitorData(phone) {
        return await this.callApi('/api/visitor-operations', {
            action: 'getVisitorData',
            phone
        });
    }

    /**
     * Update visitor data
     */
    async updateVisitorData(phone, field, value) {
        return await this.callApi('/api/visitor-operations', {
            action: 'updateVisitorData',
            phone,
            field,
            value
        });
    }

    /**
     * Get check-in data (departments, positions, staff, attendance)
     */
    async getCheckinData(phone) {
        return await this.callApi('/api/visitor-operations', {
            action: 'getCheckinData',
            phone
        });
    }

    /**
     * Get visitor log by ID
     */
    async getVisitorLog(logId) {
        return await this.callApi('/api/visitor-operations', {
            action: 'getVisitorLog',
            logId
        });
    }

    /**
     * Get selfie URL by file ID
     */
    async getSelfieUrl(fileId) {
        return await this.callApi('/api/visitor-operations', {
            action: 'getSelfieUrl',
            fileId
        });
    }

    /**
     * Upload selfie (still goes directly to storage)
     */
    async uploadSelfie(imageFile) {
        try {
            const fileUploadResult = await storage.createFile(
                VISITOR_SELFIES_BUCKET_ID,
                ID.unique(),
                imageFile
            );
            return fileUploadResult.$id;
        } catch (error) {
            console.error('Selfie upload failed:', error);
            throw new Error('Failed to upload selfie');
        }
    }

    /**
     * Delete selfie (cleanup on error)
     */
    async deleteSelfie(fileId) {
        try {
            await storage.deleteFile(VISITOR_SELFIES_BUCKET_ID, fileId);
        } catch (error) {
            console.error('Failed to delete selfie:', error);
        }
    }

    /**
     * Submit check-in request
     */
    async submitCheckin(checkinData) {
        return await this.callApi('/api/visitor-checkin', {
            action: 'checkin',
            ...checkinData
        });
    }

    /**
     * Create staff session
     */
    async createStaffSession(logId, requestToken) {
        return await this.callApi('/api/visitor-checkin', {
            action: 'createStaffSession',
            logId,
            requestToken
        });
    }

    /**
     * Validate staff session
     */
    async validateStaffSession(sessionToken, logId) {
        return await this.callApi('/api/visitor-checkin', {
            action: 'validateStaffSession',
            sessionToken,
            logId
        });
    }

    /**
     * Update visitor status (approve/reject)
     */
     async updateStatus(sessionToken, logId, newStatus, notes, rejectionReason, passDate) {
        return await this.callApi('/api/visitor-checkin', {
            action: 'updateStatus',
            sessionToken,
            logId,
            newStatus,
            notes,
            rejectionReason,
            passDate
        });
    }
}

// Export singleton instance and session store
export const visitorService = new VisitorService();