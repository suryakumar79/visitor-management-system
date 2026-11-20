// src/routes/api/visitor-checkin/+server.js

import { json } from '@sveltejs/kit';
import { Databases, Query, ID } from '$lib/server/documents.js';
import { C, DATABASE_ID, SELFIE_BUCKET } from '$lib/collections.js';
import { env } from '$env/dynamic/private';
import { v4 as uuidv4 } from 'uuid';
import { sendEmail, sendWebhook, isTestMode } from '$lib/server/notify.js';
import { checkVisitorSession, sha256, safeEqual } from '$lib/server/db.js';


// ========================================
// CONFIGURATION
// ========================================
const MAX_STAFF_SESSIONS = 15;  // ⬅️ Change this to your desired limit

// ========================================
// CLIENT MANAGEMENT
// ========================================
const databases = new Databases();

// ========================================
// SETTINGS MANAGEMENT
// ========================================
async function getSettings(databases) {
    const settingsList = await databases.listDocuments(
        DATABASE_ID,
        C.systemSettings,
        [Query.limit(100)]
    );
    

    const settings = {};
    settingsList.documents.forEach(doc => {
        settings[doc.settingKey] = doc.settingValue;
    });
    
    return settings;
}

// Mail never blocks the app: without SMTP (or in test mode) messages go to the server console.
function getEmailTransporter(settings) {
    return {
        sendMail: (m) => sendEmail({ to: m.to, subject: m.subject, text: m.text, html: m.html }, settings)
    };
}

// ========================================
// OPTIONAL WEBHOOK NOTIFICATIONS (SMS / chat), see notify.js
// ========================================
async function notifyChannel(notificationType, data) {
    return sendWebhook({ type: notificationType, ...data });
}

// ========================================
// ✅ FIXED: ASYNC NOTIFICATION SENDER
// ========================================
async function sendNotificationsAsync(params) {
    const {
        logDocument,
        visitorEmail,
        visitorPhone,
        staffEmail,
        staffPhone,
        staffParams,      // ✅ Changed: Now expects params only
        visitorParams,    // ✅ Changed: Now expects params only
        settings
    } = params;

    const logId = logDocument.$id;
    const emailTransporter = getEmailTransporter(settings);

    // Build full URLs for emails (emails can have full URLs)
    const visitorStatusUrl = `${BASE.url}/visitor/status${visitorParams}`;
    const approvalPageUrl = `${BASE.url}/staff/approve${staffParams}`;

    // Email content
    const visitorEmailSubject = `✅ Visit Request Submitted to ${logDocument.staffName}`;
    const visitorEmailBody = `Hello ${logDocument.visitorName},\n\nThank you for submitting your visit request to meet with ${logDocument.staffName}.\n\nCheck your status: ${visitorStatusUrl}\n\n---\nVisitor Management System`;

    const staffEmailSubject = `New Visitor Request - ${logDocument.visitorName}`;
    const staffEmailBody = `Hello ${logDocument.staffName},\n\nNew visitor request:\n\nVisitor: ${logDocument.visitorName}\nCompany: ${logDocument.companyName}\nPurpose: ${logDocument.purpose}\nMembers: ${logDocument.totalMembers}\n\nAPPROVE OR REJECT: ${approvalPageUrl}\n⚠️ This link expires at midnight today.\n\n---\nVisitor Management System`;

    // ✅ Fire and forget - don't block main thread
    Promise.allSettled([
        // Visitor email (full URL)
        emailTransporter.sendMail({
            from: settings.SMTP_USER,
            to: visitorEmail,
            subject: visitorEmailSubject,
            text: visitorEmailBody
        }),
        
        // Visitor webhook
        notifyChannel('visitorNotification', {
            visitorName: logDocument.visitorName,
            visitorPhone,
            staffName: logDocument.staffName,
            statusUrl: visitorParams  // ✅ Just params: "logId=abc123"
        }),
        
        // Staff email (full URL)
        emailTransporter.sendMail({
            from: settings.SMTP_USER,
            to: staffEmail,
            subject: staffEmailSubject,
            text: staffEmailBody
        }),
        
        // Staff webhook
        notifyChannel('staffNotification', {
            staffName: logDocument.staffName,
            staffPhone,
            visitorName: logDocument.visitorName,
            companyName: logDocument.companyName,
            purpose: logDocument.purpose,
            totalMembers: logDocument.totalMembers.toString(),
            approvalUrl: staffParams  // ✅ Just params: "logId=abc&token=xyz"
        })
    ]).then(results => {
        const names = ['Visitor Email', 'Visitor webhook', 'Staff Email', 'Staff webhook'];
        results.forEach((result, i) => {
            if (result.status === 'fulfilled') {
                console.log(`✅ ${names[i]} sent for log ${logId}`);
            } else {
                console.error(`❌ ${names[i]} failed for log ${logId}:`, result.reason?.message || result.reason);
            }
        });
    }).catch(err => {
        console.error(`❌ Unexpected error in notification sending for log ${logId}:`, err);
    });
}

// ========================================
// HELPER FUNCTIONS
// ========================================
function isRequestTokenExpired(requestTime) {
    if (!requestTime) return true;
    
    const requestDate = new Date(requestTime);
    const expiryDate = new Date(requestDate);
    expiryDate.setDate(expiryDate.getDate() + 7); // 7 days from request
    
    return Date.now() > expiryDate.getTime();
}

function getRequestTokenExpiry(requestTime) {
    const requestDate = new Date(requestTime);
    const expiry = new Date(requestDate);
    expiry.setDate(expiry.getDate() + 7); // 7 days from request
    return expiry.toISOString();
}

function getClientIp(request) {
    const forwardedFor = request.headers.get('x-forwarded-for');
    if (forwardedFor) return forwardedFor.split(',')[0].trim();
    
    const realIp = request.headers.get('x-real-ip');
    if (realIp) return realIp;
    
    const cfIp = request.headers.get('cf-connecting-ip');
    if (cfIp) return cfIp;
    
    return '127.0.0.1';
}

const sendWithTimeout = (promise, timeoutMs = 10000) => {
    return Promise.race([
        promise,
        new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Operation timeout')), timeoutMs)
        )
    ]);
};

// ========================================
// MAIN POST HANDLER
// ========================================
const BASE = { url: '' };

export async function POST({ request, locals, url }) {
    BASE.url = env.FRONTEND_BASE_URL || url.origin;
    const startTime = Date.now();
    const clientIp = locals.ip || 'unknown';

    try {
        const data = await request.json();
        const { action } = data;

        // Load settings (optional: missing SMTP only means e-mails are logged instead of sent)
        const settings = await getSettings(databases);

        // ========================================
        // ACTION: CREATE_STAFF_SESSION
        // ========================================
        if (action === 'createStaffSession') {
            const { logId, requestToken } = data;

            if (!logId || !requestToken) {
                return json({ 
                    success: false,
                    message: 'Missing required parameters' 
                }, { status: 400 });
            }

            let logDocument;
            try {
                logDocument = await databases.getDocument(
                    DATABASE_ID,
                    C.visitorLogs,
                    logId
                );
            } catch (error) {
                console.log(`Log not found: ${logId}`);
                return json({ 
                    success: false,
                    message: 'Visitor request not found',
                    needsLogin: true
                }, { status: 404 });
            }

            if (!safeEqual(logDocument.requestTokenHash || '', sha256(requestToken))) {
                console.log(`Invalid request token for log ${logId}`);
                return json({ 
                    success: false,
                    message: 'Invalid or expired approval link',
                    needsLogin: true
                }, { status: 401 });
            }

            if (isRequestTokenExpired(logDocument.requestTime)) {
                console.log(`Request token expired for log ${logId}`);
                return json({ 
                    success: false,
                    message: 'This approval link has expired (valid for same day only)',
                    isExpired: true
                }, { status: 401 });
            }

            if (logDocument.status !== 'pending') {
                return json({ 
                    success: false,
                    message: `This request has already been ${logDocument.status}`,
                    alreadyProcessed: true,
                    status: logDocument.status
                }, { status: 400 });
            }

            const existingSessionsResult = await databases.listDocuments(
                DATABASE_ID,
                C.staffSessions,
                [
                    Query.equal('logId', logId),
                    Query.equal('requestTokenHash', sha256(requestToken))
                ]
            );

            if (existingSessionsResult.total >= MAX_STAFF_SESSIONS) {
                console.log(`Session limit reached for log ${logId}`);
                return json({ 
                    success: false,
                    message: `Maximum session limit reached (${MAX_STAFF_SESSIONS} attempts)`,
                    sessionLimitReached: true,
                    needsLogin: true
                }, { status: 403 });
            }

            const sessionToken = uuidv4();
            const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
            
            const userAgent = request.headers.get('user-agent') || 'unknown';

            await databases.createDocument(
                DATABASE_ID,
                C.staffSessions,
                ID.unique(),
                {
                    sessionTokenHash: sha256(sessionToken),
                    staffEmail: logDocument.staffEmail,
                    logId: logId,
                    requestTokenHash: sha256(requestToken),
                    expiresAt: expiresAt.toISOString(),
                    createdAt: new Date().toISOString(),
                    isActive: true,
                    ipAddress: clientIp,
                    userAgent: userAgent
                }
            );

            console.log(`✅ Created staff session for ${logDocument.staffEmail} - Session ${existingSessionsResult.total + 1}/4`);

            return json({ 
                success: true,
                sessionToken: sessionToken,
                expiresAt: expiresAt.toISOString(),
                staffEmail: logDocument.staffEmail,
                sessionsRemaining: MAX_STAFF_SESSIONS - (existingSessionsResult.total + 1),
                logData: {
                    visitorName: logDocument.visitorName,
                    visitorEmail: logDocument.visitorEmail,
                    visitorPhone: logDocument.visitorPhone,
                    companyName: logDocument.companyName,
                    purpose: logDocument.purpose,
                    totalMembers: logDocument.totalMembers,
                    productsDesc: logDocument.productsDesc,
                    staffName: logDocument.staffName,
                    staffEmail: logDocument.staffEmail,
                    status: logDocument.status,
                    notes: logDocument.notes,
                    rejectionReason: logDocument.rejectionReason,
                }
            }, { status: 200 });
        }

        // ========================================
        // ACTION: VALIDATE_STAFF_SESSION
        // ========================================
        if (action === 'validateStaffSession') {
            const { sessionToken, logId } = data;

            if (!sessionToken || !logId) {
                return json({ 
                    success: false,
                    message: 'Missing session credentials',
                    valid: false,
                    needsLogin: true
                }, { status: 400 });
            }

            const result = await databases.listDocuments(
                DATABASE_ID,
                C.staffSessions,
                [
                    Query.equal('sessionTokenHash', sha256(sessionToken)),
                    Query.equal('logId', logId),
                    Query.equal('isActive', true),
                    Query.limit(1)
                ]
            );

            if (result.documents.length === 0) {
                return json({ 
                    success: false,
                    message: 'Invalid session',
                    valid: false,
                    needsLogin: true
                }, { status: 401 });
            }

            const session = result.documents[0];
            const now = new Date();
            const expiresAt = new Date(session.expiresAt);

            if (now > expiresAt) {
                await databases.updateDocument(
                    DATABASE_ID,
                    C.staffSessions,
                    session.$id,
                    { isActive: false }
                );

                return json({ 
                    success: false,
                    message: 'Session expired',
                    valid: false,
                    needsLogin: true
                }, { status: 401 });
            }

            const logDocument = await databases.getDocument(
                DATABASE_ID,
                C.visitorLogs,
                logId
            );

            console.log(`✅ Session valid for ${session.staffEmail}`);

            return json({ 
                success: true,
                valid: true,
                expiresAt: session.expiresAt,
                staffEmail: session.staffEmail,
                logData: {
                    visitorName: logDocument.visitorName,
                    visitorEmail: logDocument.visitorEmail,
                    visitorPhone: logDocument.visitorPhone,
                    companyName: logDocument.companyName,
                    purpose: logDocument.purpose,
                    totalMembers: logDocument.totalMembers,
                    productsDesc: logDocument.productsDesc,
                    staffName: logDocument.staffName,
                    staffEmail: logDocument.staffEmail,
                    status: logDocument.status,
                    notes: logDocument.notes,
                    rejectionReason: logDocument.rejectionReason
                }
            }, { status: 200 });
        }

        // ========================================
        // ACTION: UPDATE_STATUS
        // ========================================
        if (action === 'updateStatus') {
            const { sessionToken, logId, newStatus, notes, rejectionReason, passDate } = data;

            if (!sessionToken || !logId || !newStatus) {
                return json({ 
                    success: false,
                    message: 'Missing required fields',
                    needsLogin: true
                }, { status: 400 });
            }

            if (!['approved', 'rejected'].includes(newStatus)) {
                return json({ 
                    success: false,
                    message: 'Invalid status' 
                }, { status: 400 });
            }

            let session;
            const sessionResult = await databases.listDocuments(
                DATABASE_ID,
                C.staffSessions,
                [
                    Query.equal('sessionTokenHash', sha256(sessionToken)),
                    Query.equal('logId', logId),
                    Query.equal('isActive', true),
                    Query.limit(1)
                ]
            );

            if (sessionResult.documents.length === 0) {
                return json({ 
                    success: false,
                    message: 'Invalid or expired session',
                    needsLogin: true
                }, { status: 401 });
            }

            session = sessionResult.documents[0];

            if (new Date() > new Date(session.expiresAt)) {
                await databases.updateDocument(
                    DATABASE_ID,
                    C.staffSessions,
                    session.$id,
                    { isActive: false }
                );

                return json({ 
                    success: false,
                    message: 'Session expired',
                    needsLogin: true
                }, { status: 401 });
            }

            let logDocument;
            try {
                logDocument = await databases.getDocument(
                    DATABASE_ID,
                    C.visitorLogs,
                    logId
                );
            } catch (error) {
                return json({ 
                    success: false,
                    message: 'Visitor request not found' 
                }, { status: 404 });
            }

            if (isRequestTokenExpired(logDocument.requestTime)) {
                return json({ 
                    success: false,
                    message: 'This request has expired',
                    isExpired: true
                }, { status: 401 });
            }

            if (logDocument.status !== 'pending') {
                return json({ 
                    success: false,
                    message: `This request has already been ${logDocument.status}`,
                    alreadyProcessed: true
                }, { status: 400 });
            }

            const updateData = {
                status: newStatus,
                approvalTime: new Date().toISOString(),
                approvedBy: session.staffEmail
            };

            if (newStatus === 'approved' && notes) {
                updateData.notes = notes;
            }
            
            if (newStatus === 'approved') {
                // Save passDate — use provided date or fallback to today
                updateData.passDate = passDate || new Date().toISOString().split('T')[0];
            }


            if (newStatus === 'rejected') {
                updateData.rejectionReason = rejectionReason || 'No reason provided';
            }

            await databases.updateDocument(
                DATABASE_ID,
                C.visitorLogs,
                logId,
                updateData
            );

            console.log(`✅ Updated log ${logId} to ${newStatus} by ${session.staffEmail}`);

            const emailTransporter = getEmailTransporter(settings);
            
            const statusMessage = newStatus === 'approved' 
                ? 'Your visit request has been APPROVED' 
                : 'Your visit request has been REJECTED';
            
            const emailSubject = `Visit Request ${newStatus.toUpperCase()} - ${logDocument.staffName}`;
            
            let emailBody = `Hello ${logDocument.visitorName},\n\n${statusMessage}.\n\nVisit Details:\n- Staff Member: ${logDocument.staffName}\n- Purpose: ${logDocument.purpose}\n- Status: ${newStatus.toUpperCase()}\n`;

            if (newStatus === 'approved' && notes) {
                emailBody += `\nStaff Note: ${notes}`;
            } else if (newStatus === 'rejected' && rejectionReason) {
                emailBody += `\nRejection Reason: ${rejectionReason}`;
            }

            if (newStatus === 'approved') {
                emailBody += `\n\nPlease proceed to the reception desk.\nView your pass: ${BASE.url}/visitor/pass?logId=${logId}`;
            }

            emailBody += `\n\n---\nVisitor Management System`;

            const [emailResult, sessionUpdateResult] = await Promise.allSettled([
                sendWithTimeout(emailTransporter.sendMail({
                    from: settings.SMTP_USER,
                    to: logDocument.visitorEmail,
                    subject: emailSubject,
                    text: emailBody
                }), 8000),

                databases.updateDocument(
                    DATABASE_ID,
                    C.staffSessions,
                    session.$id,
                    { isActive: false }
                )
            ]);

            if (emailResult.status === 'fulfilled') {
                console.log(`✅ Email notification sent to visitor`);
            } else {
                console.log(`⚠️ Email notification failed: ${emailResult.reason?.message}`);
            }

            if (sessionUpdateResult.status === 'fulfilled') {
                console.log(`✅ Invalidated session after action`);
            }

            return json({ 
                success: true,
                message: `Request ${newStatus} successfully`,
                sessionEnded: true
            }, { status: 200 });
        }

        // ========================================
        // ✅ FIXED ACTION: CHECKIN
        // ========================================
        if (action === 'checkin') {
            const { 
                visitorPhone, visitorName, visitorEmail, companyName, 
                departmentId, positionId, staffId,
                purpose, totalMembers, selfieFileId, productsDesc, bookingId, sessionToken
            } = data;

            if (!visitorPhone || !visitorName || !visitorEmail || !companyName || 
                !departmentId || !positionId || !staffId || !purpose || !totalMembers || !selfieFileId) {
                return json({ 
                    success: false,
                    message: 'Missing required fields' 
                }, { status: 400 });
            }

            // The visitor must have passed the OTP check (session issued by /api/otp)
            if (!(await checkVisitorSession(sessionToken, visitorPhone))) {
                return json({ success: false, message: 'Session expired. Please verify your phone number again.' }, { status: 401 });
            }

            // Staff contact details come from the database, never from the browser
            let staffDoc;
            try {
                staffDoc = await databases.getDocument(DATABASE_ID, C.staff, staffId);
            } catch {
                return json({ success: false, message: 'The selected staff member was not found' }, { status: 404 });
            }
            if (staffDoc.status && staffDoc.status !== 'active') {
                return json({ success: false, message: 'The selected staff member is not available' }, { status: 400 });
            }
            const staffName = staffDoc.name;
            const staffEmail = staffDoc.email;
            const staffPhone = staffDoc.phone;

            const requestToken = uuidv4();
            const currentTime = new Date().toISOString();
            const tokenExpiresAt = getRequestTokenExpiry(currentTime);

            if (!selfieFileId || selfieFileId.length < 10) {
                return json({ 
                    success: false,
                    message: 'Invalid selfie file ID' 
                }, { status: 400 });
            }

            // Create visitor log
            const logDocument = await databases.createDocument(
                DATABASE_ID,
                C.visitorLogs,
                ID.unique(),
                {
                    visitorPhone, visitorName, visitorEmail, companyName,
                    departmentId, positionId, staffId, staffName, staffEmail, staffPhone,
                    purpose,
                    totalMembers: parseInt(totalMembers, 10),
                    productsDesc: productsDesc || 'N/A',
                    selfieFileId,
                    status: 'pending',
                    requestTokenHash: sha256(requestToken),
                    requestTime: currentTime,
                    requestTokenExpiresAt: tokenExpiresAt,
                    checkinTime: null,
                    checkoutTime: null,
                    approvalTime: null,
                    approvedBy: null,
                    rejectionReason: null,
                    notes: '',
                    bookingId: bookingId || null,
                    sessionCreatedAt: null
                }
            );

            console.log(`✅ Created log ${logDocument.$id} in ${Date.now() - startTime}ms`);

            // ✅ FIX: Create only query parameters (not full URLs)
            const staffParams = `?logId=${logDocument.$id}&token=${requestToken}`;
            const visitorParams = `?logId=${logDocument.$id}`;

            // Notifications go out by e-mail and the optional webhook
            sendNotificationsAsync({
                logDocument,
                visitorEmail,
                visitorPhone,
                staffEmail,
                staffPhone,
                staffParams,      // ✅ Just params
                visitorParams,    // ✅ Just params
                settings
            });

            // Build full URL for API response
            const visitorStatusUrl = `${BASE.url}/visitor/status${visitorParams}`;

            console.log(`✅ Check-in API response sent in ${Date.now() - startTime}ms`);
            
            return json({ 
                success: true,
                logId: logDocument.$id,
                statusUrl: visitorStatusUrl,
                // Test mode only: lets you open the host's approval page without e-mail/webhook
                ...(isTestMode() ? { testApprovalUrl: `${BASE.url}/staff/approve${staffParams}` } : {}),
                message: 'Check-in request submitted'
            }, { status: 200 });
        }

        // ========================================
        // ACTION: CHECKIN_CONFIRM
        // ========================================
        if (action === 'checkinConfirm') {
            const { logId } = data;

            if (!logId) {
                return json({ 
                    success: false,
                    message: 'Missing logId' 
                }, { status: 400 });
            }

            try {
                await databases.updateDocument(
                    DATABASE_ID,
                    C.visitorLogs,
                    logId,
                    {
                        status: 'checked-in',
                        checkinTime: new Date().toISOString()
                    }
                );

                console.log(`✅ Visitor checked in: ${logId}`);

                return json({ 
                    success: true,
                    message: 'Check-in confirmed'
                }, { status: 200 });

            } catch (error) {
                console.error(`❌ Check-in confirm failed: ${error.message}`);
                return json({ 
                    success: false,
                    message: error.message || 'Check-in failed' 
                }, { status: 500 });
            }
        }

        // ========================================
        // ACTION: CHECKOUT
        // ========================================
        if (action === 'checkout') {
            const { logId } = data;

            if (!logId) {
                return json({ 
                    success: false,
                    message: 'Missing logId' 
                }, { status: 400 });
            }

            try {
                const log = await databases.getDocument(
                    DATABASE_ID,
                    C.visitorLogs,
                    logId
                );

                const totalMembers = log.totalMembers || 1;
                const totalMembersOut = parseInt(log.totalMembersOut) || 0;
                const isFullCheckout = totalMembersOut >= totalMembers;

                console.log(`✅ Visitor ${isFullCheckout ? 'fully' : 'partially'} checked out: ${logId}`);

                if (isFullCheckout) {
                    const emailTransporter = getEmailTransporter(settings);
                    
                    const emailSubject = `Visit Completed - ${log.visitorName}`;
                    const emailBody = `Hello ${log.staffName},\n\n${log.visitorName} from ${log.companyName} has checked out.\n\n---\nVisitor Management System`;

                    emailTransporter.sendMail({
                        from: settings.SMTP_USER,
                        to: log.staffEmail,
                        subject: emailSubject,
                        text: emailBody
                    }).catch(err => console.error('Email send failed:', err));
                }

                return json({ 
                    success: true,
                    message: isFullCheckout ? 'Full checkout confirmed' : 'Partial checkout confirmed',
                    isFullCheckout,
                    totalMembersOut,
                    totalMembers
                }, { status: 200 });

            } catch (error) {
                console.error(`❌ Checkout failed: ${error.message}`);
                return json({ 
                    success: false,
                    message: error.message || 'Checkout failed' 
                }, { status: 500 });
            }
        }

        return json({ 
            success: false,
            message: 'Invalid action specified' 
        }, { status: 400 });

    } catch (error) {
        console.error(`❌ Visitor checkin error: ${error.message} - IP: ${clientIp} - ${Date.now() - startTime}ms`);
        return json({ 
            success: false,
            message: error.message || 'Server error occurred' 
        }, { status: 500 });
    }
}