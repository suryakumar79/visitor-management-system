// src/routes/api/receptionist/dashboard/+server.js
import { json } from '@sveltejs/kit';
import { guard } from '$lib/server/auth.js';
import { Databases, Query, ID } from '$lib/server/documents.js';
import { C, DATABASE_ID, SELFIE_BUCKET } from '$lib/collections.js';
import { env } from '$env/dynamic/private';

// ========================================
// CLIENT MANAGEMENT
// ========================================
const databases = new Databases();

// ========================================
// HELPER FUNCTIONS
// ========================================
function isPassExpired(passDate, approvalTime) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Use passDate if available (new records)
    if (passDate && /^\d{4}-\d{2}-\d{2}$/.test(passDate)) {
        const [year, month, day] = passDate.split('-').map(Number);
        const passDay = new Date(year, month - 1, day); // Local time, no UTC shift
        passDay.setHours(0, 0, 0, 0);
        return passDay < today;
    }

    // Fallback to approvalTime for old records
    if (!approvalTime) return false;
    const approved = new Date(approvalTime);
    approved.setHours(0, 0, 0, 0);
    return approved < today;
}

// ========================================
// MAIN POST HANDLER
// ========================================
export async function POST(event) {
    const { request } = event;
    const auth = guard(event, 'reception', 'admin');
    if (auth.response) return auth.response;
    const startTime = Date.now();

    try {
        const data = await request.json();
        const { action } = data;

        // ========================================
        // ACTION: GET_STATS
        // ========================================
        if (action === 'getStats') {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const todayISO = today.toISOString();

            // ✅ Fetch checked-in today (by checkinTime, not requestTime)
            const [checkedInResult, checkedOutResult, currentlyInsideResult] = await Promise.all([
                // Visitors who checked in today (regardless of when they requested)
                databases.listDocuments(
                    DATABASE_ID,
                    C.visitorLogs,
                    [
                        Query.greaterThanEqual('checkinTime', todayISO),
                        Query.limit(500)
                    ]
                ),
                // Visitors who fully checked out today
                databases.listDocuments(
                    DATABASE_ID,
                    C.visitorLogs,
                    [
                        Query.greaterThanEqual('checkoutTime', todayISO),
                        Query.equal('status', 'checked-out'),
                        Query.limit(500)
                    ]
                ),
                // Currently inside (checked-in or partial-checkout, any date)
                databases.listDocuments(
                    DATABASE_ID,
                    C.visitorLogs,
                    [
                        Query.or([
                            Query.equal('status', 'checked-in'),
                            Query.equal('status', 'partial-checkout')
                        ]),
                        Query.limit(500)
                    ]
                )
            ]);

            let totalMembersIn = 0;
            currentlyInsideResult.documents.forEach(log => {
                totalMembersIn += (log.totalMembers || 1) - (parseInt(log.totalMembersOut) || 0);
            });

            console.log(`✅ Stats retrieved - ${Date.now() - startTime}ms`);

            return json({
                success: true,
                stats: {
                    totalCheckedIn: checkedInResult.total,
                    currentlyInside: currentlyInsideResult.total,
                    checkedOut: checkedOutResult.total,
                    totalVisitorsIn: totalMembersIn
                }
            }, { status: 200 });
        }

        // ========================================
        // ACTION: PROCESS_QR_SCAN
        // ========================================
        if (action === 'processQRScan') {
            const { logId } = data;

            if (!logId) {
                return json({
                    success: false,
                    message: 'Missing logId'
                }, { status: 400 });
            }

             let log;
    try {
        // Try exact match first
        log = await databases.getDocument(
            DATABASE_ID,
            C.visitorLogs,
            logId
        );
    } catch (error) {
        // If exact match fails, search by partial ID (startsWith)
        const searchResult = await databases.listDocuments(
            DATABASE_ID,
            C.visitorLogs,
            [
                Query.startsWith('$id', logId),
                Query.limit(1)
            ]
        );

        if (searchResult.documents.length === 0) {
            return json({
                success: false,
                message: 'Visitor pass not found. Please check the ID.'
            }, { status: 404 });
        }

        log = searchResult.documents[0];
    }

            // Check for invalid states
            if (log.status === 'rejected') {
                return json({
                    success: false,
                    action: 'rejected',
                    message: 'This visitor pass has been REJECTED',
                    log: log
                }, { status: 200 });
            }

            if (log.status === 'pending') {
                return json({
                    success: false,
                    action: 'pending',
                    message: 'This visitor pass is still PENDING approval',
                    log: log
                }, { status: 200 });
            }

            if (log.passDate && /^\d{4}-\d{2}-\d{2}$/.test(log.passDate)) {
                const [year, month, day] = log.passDate.split('-').map(Number);
                const passDay = new Date(year, month - 1, day);
                passDay.setHours(0, 0, 0, 0);

                const today = new Date();
                today.setHours(0, 0, 0, 0);

                if (passDay > today) {
                    return json({
                        success: false,
                        action: 'not_yet_valid',
                        message: `This pass is not valid yet. It is valid on ${log.passDate}`,
                        log: log
                    }, { status: 200 });
                }
            }

            if (isPassExpired(log.passDate, log.approvalTime)) {
                return json({
                    success: false,
                    action: 'expired',
                    message: 'This visitor pass has EXPIRED',
                    log: log
                }, { status: 200 });
            }

            if (log.status === 'checked-out') {
                return json({
                    success: false,
                    action: 'invalid',
                    message: 'This pass has already been used and checked out',
                    log: log
                }, { status: 200 });
            }

            console.log(`✅ QR scan processed: ${logId} - ${Date.now() - startTime}ms`);

            return json({
                success: true,
                log: log
            }, { status: 200 });
        }

        // ========================================
        // ACTION: CHECKIN
        // ========================================
        if (action === 'checkin') {
            const { logId, memberCount, receptionistId, receptionistName } = data;

            if (!logId || !memberCount) {
                return json({
                    success: false,
                    message: 'Missing required fields'
                }, { status: 400 });
            }

            const updateData = {
                totalMembers: parseInt(memberCount),
                status: 'checked-in',
                checkinTime: new Date().toISOString(),
                checkedInBy: receptionistName || 'Unknown',
                checkedInById: receptionistId || 'unknown'
            };

            await databases.updateDocument(
                DATABASE_ID,
                C.visitorLogs,
                logId,
                updateData
            );

            const updatedLog = await databases.getDocument(
                DATABASE_ID,
                C.visitorLogs,
                logId
            );

            console.log(`✅ Check-in: ${logId} by ${receptionistName} - ${Date.now() - startTime}ms`);

            return json({
                success: true,
                log: updatedLog
            }, { status: 200 });
        }

        // ========================================
        // ACTION: CHECKOUT
        // ========================================
        if (action === 'checkout') {
            const { logId, memberCount, receptionistId, receptionistName } = data;

            if (!logId || !memberCount) {
                return json({
                    success: false,
                    message: 'Missing required fields'
                }, { status: 400 });
            }

            const log = await databases.getDocument(
                DATABASE_ID,
                C.visitorLogs,
                logId
            );

            const currentMembersOut = parseInt(log.totalMembersOut) || 0;
            const newTotalMembersOut = currentMembersOut + parseInt(memberCount);
            const totalMembers = log.totalMembers || 1;
            const isFullCheckout = newTotalMembersOut >= totalMembers;

            const updateData = {
                totalMembersOut: newTotalMembersOut.toString(),
                status: isFullCheckout ? 'checked-out' : 'partial-checkout',
                checkedOutBy: receptionistName || 'Unknown',
                checkedOutById: receptionistId || 'unknown'
            };

            if (isFullCheckout) {
                updateData.checkoutTime = new Date().toISOString();
            }

            await databases.updateDocument(
                DATABASE_ID,
                C.visitorLogs,
                logId,
                updateData
            );

            const updatedLog = await databases.getDocument(
                DATABASE_ID,
                C.visitorLogs,
                logId
            );

            console.log(`✅ ${isFullCheckout ? 'Full' : 'Partial'} Check-out: ${logId} by ${receptionistName} - ${Date.now() - startTime}ms`);

            return json({
                success: true,
                log: updatedLog,
                isFullCheckout: isFullCheckout,
                totalMembersOut: newTotalMembersOut
            }, { status: 200 });
        }

        // Invalid action
        return json({
            success: false,
            message: 'Invalid action specified'
        }, { status: 400 });

    } catch (error) {
        console.error(`❌ Receptionist dashboard error: ${error.message} - ${Date.now() - startTime}ms`);
        return json({
            success: false,
            message: error.message || 'Server error occurred'
        }, { status: 500 });
    }
}