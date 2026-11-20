// src/routes/api/visitor-operations/+server.js
import { json } from '@sveltejs/kit';
import { Databases, Query, ID } from '$lib/server/documents.js';
import { C, DATABASE_ID, SELFIE_BUCKET } from '$lib/collections.js';
import { env } from '$env/dynamic/private';
import crypto from 'crypto';
import { checkVisitorSession, signedFileUrl } from '$lib/server/db.js';

// ========================================
// CLIENT MANAGEMENT
// ========================================
const databases = new Databases();

// ========================================
// RATE LIMITING
// ========================================
const rateLimitStore = new Map();

const RATE_LIMITS = {
    getVisitorData: { maxRequests: 10, windowMs: 60000 },
    updateVisitorData: { maxRequests: 5, windowMs: 60000 },
    getCheckinData: { maxRequests: 10, windowMs: 60000 },
    getVisitorLog: { maxRequests: 20, windowMs: 60000 },
    getSelfieUrl: { maxRequests: 30, windowMs: 60000 }
};

function checkRateLimit(key, action) {
    const config = RATE_LIMITS[action] || { maxRequests: 10, windowMs: 60000 };
    const rateLimitKey = `${action}:${key}`;
    const now = Date.now();
    
    if (!rateLimitStore.has(rateLimitKey)) {
        rateLimitStore.set(rateLimitKey, { count: 0, resetAt: now + config.windowMs });
    }
    
    const entry = rateLimitStore.get(rateLimitKey);
    
    if (now > entry.resetAt) {
        entry.count = 0;
        entry.resetAt = now + config.windowMs;
    }
    
    if (entry.count >= config.maxRequests) {
        const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
        return { allowed: false, retryAfter };
    }
    
    entry.count++;
    return { allowed: true, retryAfter: 0 };
}

// Cleanup interval
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitStore.entries()) {
        if (now > entry.resetAt + 60000) {
            rateLimitStore.delete(key);
        }
    }
}, 5 * 60 * 1000);

// ========================================
// SESSION MANAGEMENT
// ========================================
// Sessions live in SQL and are only issued by /api/otp after a successful OTP check.
async function validateSessionToken(token, phone) {
    return (await checkVisitorSession(token, phone)) !== null;
}

// ========================================
// UTILITY FUNCTIONS
// ========================================
function getClientIp(request) {
    const forwardedFor = request.headers.get('x-forwarded-for');
    if (forwardedFor) return forwardedFor.split(',')[0].trim();
    
    const realIp = request.headers.get('x-real-ip');
    if (realIp) return realIp;
    
    const cfIp = request.headers.get('cf-connecting-ip');
    if (cfIp) return cfIp;
    
    return '127.0.0.1';
}

// ⚡ NORMALIZE PHONE NUMBER HELPER
function normalizePhoneNumber(phone) {
    if (!phone) return null;
    const cleaned = phone.replace(/\D/g, '');
    return phone.startsWith('+') ? phone : `+${cleaned}`;
}

const phoneRegex = /^\+?[1-9]\d{9,14}$/;
const validatePhoneNumber = (phone) => phoneRegex.test(phone.replace(/\s/g, ''));

// ========================================
// MAIN POST HANDLER
// ========================================
export async function POST({ request, locals }) {
    const startTime = Date.now();
    const clientIp = locals.ip || 'unknown';

    try {
        const data = await request.json();
        const { action, phone, sessionToken } = data;

        // ========================================
        // PHONE VALIDATION & NORMALIZATION
        // ========================================
        const protectedActions = ['getVisitorData', 'updateVisitorData', 'getCheckinData'];
        let normalizedPhone = null;

        if (phone) {
            if (!validatePhoneNumber(phone)) {
                return json(
                    { success: false, message: 'Invalid phone number format' },
                    { status: 400 }
                );
            }
            normalizedPhone = normalizePhoneNumber(phone);
        }

        // Protected actions require phone
        if (protectedActions.includes(action)) {
            if (!normalizedPhone) {
                return json(
                    { success: false, message: 'Phone number required' },
                    { status: 400 }
                );
            }

            // Validate session token if provided
            if (!(await validateSessionToken(sessionToken, normalizedPhone))) {
                console.log(`Invalid session token for phone: ${normalizedPhone}`);
                return json(
                    {
                        success: false,
                        message: 'Invalid or expired session',
                        needsLogin: true
                    },
                    { status: 401 }
                );
            }
        }

        // ========================================
        // RATE LIMITING
        // ========================================
        const rateLimitKey = normalizedPhone ?? clientIp;
        const rateLimit = checkRateLimit(rateLimitKey, action);
        
        if (!rateLimit.allowed) {
            console.log(`Rate limit exceeded for ${action} - ${rateLimitKey}`);
            return json({ 
                success: false,
                message: `Too many requests. Please try again in ${rateLimit.retryAfter} seconds.`,
                retryAfter: rateLimit.retryAfter
            }, { status: 429 });
        }

        // Log request
        console.log(`[${action}] Phone: ${normalizedPhone || 'N/A'} IP: ${clientIp} Session: ${sessionToken ? 'Valid' : 'None'}`);

        // ========================================
        // ACTION: CREATE_SESSION
        // ========================================
        if (action === 'createSession') {
            // Sessions are issued by /api/otp after OTP verification. This only extends a valid one.
            if (!normalizedPhone || !(await validateSessionToken(sessionToken, normalizedPhone))) {
                return json({ success: false, message: 'Please verify your phone number with an OTP first', needsLogin: true }, { status: 401 });
            }
            return json({ success: true, sessionToken, expiresAt: await checkVisitorSession(sessionToken, normalizedPhone), phone: normalizedPhone }, { status: 200 });
        }

        // ========================================
        // ACTION: VALIDATE_SESSION
        // ========================================
        if (action === 'validateSession') {
            const { sessionToken, phone } = data;

            if (!sessionToken || !normalizedPhone) {
                return json({ 
                    success: false,
                    message: 'Missing session credentials',
                    valid: false
                }, { status: 400 });
            }

            const isValid = await validateSessionToken(sessionToken, normalizedPhone);

            if (!isValid) {
                console.log(`Invalid session validation attempt for ${normalizedPhone}`);
                return json({ 
                    success: false,
                    message: 'Invalid or expired session',
                    valid: false,
                    needsLogin: true
                }, { status: 401 });
            }

            const session = { expiresAt: await checkVisitorSession(sessionToken, normalizedPhone) };

            console.log(`✅ Session validated for ${normalizedPhone}`);

            return json({ 
                success: true,
                valid: true,
                expiresAt: session.expiresAt
            }, { status: 200 });
        }

        // ========================================
        // ACTION: GET_VISITOR_DATA
        // ========================================
        if (action === 'getVisitorData') {
            const visitorResult = await databases.listDocuments(
                DATABASE_ID,
                C.visitors,
                [
                    Query.equal('phone', normalizedPhone),
                    Query.limit(1)
                ]
            );

            if (visitorResult.documents.length === 0) {
                return json({ 
                    success: false,
                    message: 'Visitor not found',
                    registered: false
                }, { status: 404 });
            }

            const visitor = visitorResult.documents[0];

            console.log(`✅ Retrieved visitor data for ${normalizedPhone}`);

            return json({ 
                success: true,
                registered: true,
                visitor: {
                    id: visitor.$id,
                    name: visitor.name,
                    email: visitor.email,
                    phone: visitor.phone,
                    companyName: visitor.companyName,
                    role: visitor.role
                }
            }, { status: 200 });
        }

        // ========================================
        // ACTION: UPDATE_VISITOR_DATA
        // ========================================
        if (action === 'updateVisitorData') {
            const { field, value } = data;

            if (!field || value === undefined) {
                return json({ 
                    success: false,
                    message: 'Missing field or value'
                }, { status: 400 });
            }

            const allowedFields = ['name', 'email', 'companyName'];
            if (!allowedFields.includes(field)) {
                return json({ 
                    success: false,
                    message: 'Invalid field'
                }, { status: 400 });
            }

            // Field validation
            if (field === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
                return json({ 
                    success: false,
                    message: 'Invalid email format'
                }, { status: 400 });
            }

            if ((field === 'name' || field === 'companyName') && !value.trim()) {
                return json({ 
                    success: false,
                    message: `${field} cannot be empty`
                }, { status: 400 });
            }

            const visitorResult = await databases.listDocuments(
                DATABASE_ID,
                C.visitors,
                [Query.equal('phone', normalizedPhone), Query.limit(1)]
            );

            if (visitorResult.documents.length === 0) {
                return json({ 
                    success: false,
                    message: 'Visitor not found'
                }, { status: 404 });
            }

            const visitor = visitorResult.documents[0];
            const updateData = { [field]: value };

            await databases.updateDocument(
                DATABASE_ID,
                C.visitors,
                visitor.$id,
                updateData
            );

            console.log(`✅ Updated ${field} for visitor ${normalizedPhone}`);

            return json({ 
                success: true,
                message: `${field} updated successfully`
            }, { status: 200 });
        }

        // ========================================
        // ACTION: GET_CHECKIN_DATA
        // ========================================
        if (action === 'getCheckinData') {
            const todayDate = new Date().toISOString().substring(0, 10);

            const [deptResult, posResult, staffResult, attendanceResult] = await Promise.all([
                databases.listDocuments(
                    DATABASE_ID, 
                    C.departments, 
                    [Query.orderAsc('name'), Query.limit(100)]
                ),
                databases.listDocuments(
                    DATABASE_ID, 
                    C.positions, 
                    [Query.orderAsc('name'), Query.limit(100)]
                ),
                databases.listDocuments(
                    DATABASE_ID,
                    C.staff,
                    [
                        Query.equal('status', 'active'),
                        Query.limit(500),
                        Query.orderAsc('name')
                    ]
                ),
                databases.listDocuments(
                    DATABASE_ID,
                    C.attendance,
                    [
                        Query.equal('attendanceDate', todayDate),
                        Query.equal('status', 'Absent'),
                        Query.limit(500)
                    ]
                )
            ]);

            const absentEmployeeCodes = new Set(
                attendanceResult.documents.map(doc => doc.employeeCode)
            );

            const staff = staffResult.documents.map(s => ({
                id: s.$id,
                name: s.name,
                departmentId: s.departmentId,
                positionId: s.positionId,
                employeeCode: s.employeeCode,
                isOnLeave: absentEmployeeCodes.has(s.employeeCode)
            }));

            console.log(`✅ Retrieved check-in data for ${normalizedPhone}`);

            return json({ 
                success: true,
                departments: deptResult.documents.map(d => ({
                    id: d.$id,
                    name: d.name,
                    status: d.status || null
                })),
                positions: posResult.documents.map(p => ({
                    id: p.$id,
                    name: p.name,
                    departmentId: p.departmentId,
                    status: p.status || null
                })),
                staff
            }, { status: 200 });
        }

        // ========================================
        // ACTION: GET_VISITOR_LOG
        // ========================================
        if (action === 'getVisitorLog') {
            const { logId } = data;

            if (!logId) {
                return json({ 
                    success: false,
                    message: 'Missing logId'
                }, { status: 400 });
            }

            const log = await databases.getDocument(
                DATABASE_ID,
                C.visitorLogs,
                logId
            );

            let departmentName = null;
            if (log.departmentId) {
                try {
                    const dept = await databases.getDocument(
                        DATABASE_ID,
                        C.departments,
                        log.departmentId
                    );
                    departmentName = dept.name;
                } catch (err) {
                    console.log(`Department not found: ${err.message}`);
                }
            }

            console.log(`✅ Retrieved visitor log ${logId}`);

            return json({ 
                success: true,
                log: {
                    id: log.$id,
                    visitorName: log.visitorName,
                    visitorEmail: log.visitorEmail,
                    visitorPhone: log.visitorPhone,
                    companyName: log.companyName,
                    departmentId: log.departmentId,
                    departmentName: departmentName,
                    positionId: log.positionId,
                    staffId: log.staffId,
                    staffName: log.staffName,
                    staffEmail: log.staffEmail,
                    purpose: log.purpose,
                    totalMembers: log.totalMembers,
                    productsDesc: log.productsDesc,
                    selfieFileId: log.selfieFileId,
                    status: log.status,
                    requestTime: log.requestTime,
                    approvalTime: log.approvalTime,
                    checkinTime: log.checkinTime,
                    checkoutTime: log.checkoutTime,
                    notes: log.notes,
                    rejectionReason: log.rejectionReason,
                    passDate: log.passDate || null 
                }
            }, { status: 200 });
        }

       // ========================================
// ACTION: GET_SELFIE_URL (NO PROCESSING)
// ========================================
if (action === 'getSelfieUrl') {
    const { fileId } = data;
    
    if (!fileId) {
        return json({ 
            success: false,
            message: 'Missing fileId'
        }, { status: 400 });
    }
    
    try {
        // ✅ Just return direct view URL - no processing/resizing
        const viewUrl = await signedFileUrl(SELFIE_BUCKET, fileId, 60);
        
        console.log(`✅ Generated selfie view URL`);
        
        return json({ 
            success: true,
            url: viewUrl
        }, { status: 200 });
        
    } catch (error) {
        console.error(`Failed to generate selfie URL: ${error.message}`);
        return json({ 
            success: false,
            message: 'Failed to load image'
        }, { status: 500 });
    }
}
        // Invalid action
        return json({ 
            success: false,
            message: 'Invalid action specified' 
        }, { status: 400 });

    } catch (error) {
        console.error(`❌ Visitor operations error: ${error.message} - IP: ${clientIp} - ${Date.now() - startTime}ms`);
        return json({ 
            success: false,
            message: error.message || 'Server error occurred' 
        }, { status: 500 });
    }
}