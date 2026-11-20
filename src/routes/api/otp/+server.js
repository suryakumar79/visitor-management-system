// src/routes/api/otp/+server.js
import { json } from '@sveltejs/kit';
import { Databases, Query, ID } from '$lib/server/documents.js';
import { C, DATABASE_ID, SELFIE_BUCKET } from '$lib/collections.js';
import { env } from '$env/dynamic/private';
import crypto from 'crypto';
import { sendWebhook, isTestMode } from '$lib/server/notify.js';
import { issueVisitorSession, checkVisitorSession, sha256, safeEqual } from '$lib/server/db.js';

// OTPs are stored hashed (bound to the phone number); the plain code only exists in the outgoing message
const hashOtp = (phone, otp) => sha256(`${phone}|${otp}`);
const mask = (p) => '***' + String(p || '').slice(-4);

// ========================================
// CLIENT MANAGEMENT (OPTIMIZED: Singleton pattern)
// ========================================
const databases = new Databases();

// ========================================
// RATE LIMITING (OPTIMIZED: Efficient cleanup)
// ========================================
const rateLimitStore = new Map();
const ipRateLimitStore = new Map();

const RATE_LIMITS = {
    perTenMinutes: 5,
    perDay: 15,
    ipPerTenMinutes: 20,
    tenMinutesMs: 10 * 60 * 1000,
    oneDayMs: 24 * 60 * 60 * 1000
};

// OPTIMIZED: Cleanup interval - only run when needed
let cleanupInterval = null;
let lastCleanup = Date.now();
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

function ensureCleanupRunning() {
    if (cleanupInterval) return;
    
    cleanupInterval = setInterval(() => {
        const now = Date.now();
        
        // Only cleanup if there's data to clean
        if (rateLimitStore.size === 0 && ipRateLimitStore.size === 0) {
            return;
        }
        
        // OPTIMIZED: Batch cleanup
        const phoneKeysToDelete = [];
        for (const [phone, data] of rateLimitStore.entries()) {
            if (now > data.dailyResetAt + RATE_LIMITS.oneDayMs) {
                phoneKeysToDelete.push(phone);
            }
        }
        phoneKeysToDelete.forEach(key => rateLimitStore.delete(key));
        
        const ipKeysToDelete = [];
        for (const [ip, data] of ipRateLimitStore.entries()) {
            if (now > data.resetAt) {
                ipKeysToDelete.push(ip);
            }
        }
        ipKeysToDelete.forEach(key => ipRateLimitStore.delete(key));
        
        lastCleanup = now;
        
        // OPTIMIZED: Stop cleanup if stores are empty
        if (rateLimitStore.size === 0 && ipRateLimitStore.size === 0) {
            clearInterval(cleanupInterval);
            cleanupInterval = null;
        }
    }, CLEANUP_INTERVAL_MS);
}

// OPTIMIZED: Lazy initialization
function getRateLimitData(phoneNumber) {
    if (!rateLimitStore.has(phoneNumber)) {
        rateLimitStore.set(phoneNumber, {
            shortTerm: [],
            dailyCount: 0,
            dailyResetAt: Date.now() + RATE_LIMITS.oneDayMs
        });
        ensureCleanupRunning();
    }
    return rateLimitStore.get(phoneNumber);
}

function getIpRateLimitData(ip) {
    if (!ipRateLimitStore.has(ip)) {
        ipRateLimitStore.set(ip, {
            requests: [],
            resetAt: Date.now() + RATE_LIMITS.tenMinutesMs
        });
        ensureCleanupRunning();
    }
    return ipRateLimitStore.get(ip);
}

// OPTIMIZED: More efficient rate limit checking
function checkOtpRateLimit(phoneNumber) {
    const now = Date.now();
    const data = getRateLimitData(phoneNumber);
    
    // Check daily reset
    if (now > data.dailyResetAt) {
        data.dailyCount = 0;
        data.dailyResetAt = now + RATE_LIMITS.oneDayMs;
        data.shortTerm = [];
    }
    
    // Check daily limit first (faster check)
    if (data.dailyCount >= RATE_LIMITS.perDay) {
        return {
            allowed: false,
            reason: `Daily OTP limit reached (${RATE_LIMITS.perDay}/day). Please try again tomorrow.`,
            retryAfter: Math.ceil((data.dailyResetAt - now) / 1000),
            limitType: 'daily'
        };
    }
    
    // OPTIMIZED: Filter and slice in one pass
    const validTimestamps = [];
    for (let i = data.shortTerm.length - 1; i >= 0; i--) {
        if (now - data.shortTerm[i] < RATE_LIMITS.tenMinutesMs) {
            validTimestamps.unshift(data.shortTerm[i]);
            if (validTimestamps.length >= RATE_LIMITS.perTenMinutes) break;
        }
    }
    data.shortTerm = validTimestamps;
    
    if (data.shortTerm.length >= RATE_LIMITS.perTenMinutes) {
        const oldestTimestamp = data.shortTerm[0];
        return {
            allowed: false,
            reason: `Too many OTP requests. You can request ${RATE_LIMITS.perTenMinutes} OTPs per 10 minutes. Please wait.`,
            retryAfter: Math.ceil((oldestTimestamp + RATE_LIMITS.tenMinutesMs - now) / 1000),
            limitType: 'shortTerm'
        };
    }
    
    return { allowed: true };
}

function checkIpRateLimit(ip) {
    if (ip === 'unknown') return { allowed: true };
    
    const now = Date.now();
    const data = getIpRateLimitData(ip);
    
    if (now > data.resetAt) {
        data.requests = [];
        data.resetAt = now + RATE_LIMITS.tenMinutesMs;
    }
    
    // OPTIMIZED: In-place filter
    let writeIdx = 0;
    for (let readIdx = 0; readIdx < data.requests.length; readIdx++) {
        if (now - data.requests[readIdx] < RATE_LIMITS.tenMinutesMs) {
            data.requests[writeIdx++] = data.requests[readIdx];
        }
    }
    data.requests.length = writeIdx;
    
    if (data.requests.length >= RATE_LIMITS.ipPerTenMinutes) {
        return {
            allowed: false,
            reason: 'Too many requests from your network. Please try again later.',
            retryAfter: Math.ceil((data.resetAt - now) / 1000)
        };
    }
    
    return { allowed: true };
}

function recordOtpRequest(phoneNumber, ip) {
    const phoneData = getRateLimitData(phoneNumber);
    phoneData.shortTerm.push(Date.now());
    phoneData.dailyCount++;
    
    if (ip !== 'unknown') {
        const ipData = getIpRateLimitData(ip);
        ipData.requests.push(Date.now());
    }
}

// OPTIMIZED: Inline calculation, no unnecessary filtering
function getUsageStats(phoneNumber) {
    const data = getRateLimitData(phoneNumber);
    const now = Date.now();
    
    let shortTermCount = 0;
    for (let i = data.shortTerm.length - 1; i >= 0; i--) {
        if (now - data.shortTerm[i] < RATE_LIMITS.tenMinutesMs) {
            shortTermCount++;
        } else {
            break; // Array is sorted, so we can break early
        }
    }
    
    return {
        shortTermCount,
        shortTermLimit: RATE_LIMITS.perTenMinutes,
        dailyCount: data.dailyCount,
        dailyLimit: RATE_LIMITS.perDay
    };
}

// ========================================
// SECURITY (OPTIMIZED: Constant-time comparison)
// ========================================
function constantTimeCompare(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    try {
        return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
    } catch {
        return false;
    }
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
// ========================================
// VALIDATION (OPTIMIZED: Precompiled regex)
// ========================================
const phoneRegex = /^\+[1-9]\d{1,14}$/;
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const nameRegex = /\d/;

const validatePhoneNumber = (phone) => phoneRegex.test(phone);
const validateEmail = (email) => emailRegex.test(email);
const validateName = (name) => name.length >= 2 && !nameRegex.test(name);

// ========================================
// SEND OTP (webhook / console, see notify.js)
// ========================================
async function deliverOtp(phoneNumber, otp) {
    // Test mode / no gateway configured: the OTP is shown on the login page instead.
    const result = await sendWebhook({ type: 'otp', phone: phoneNumber, otp });
    if (!result.success) throw new Error('Failed to deliver the OTP');
    return result;
}

// ========================================
// MAIN POST HANDLER
// ========================================
export async function POST({ request, locals }) {
    const startTime = Date.now();
    const clientIp = locals.ip || 'unknown';

    try {
        const data = await request.json();
        const { action, phoneNumber, otp } = data;

        // OPTIMIZED: Bot detection (quick check)
        if (data.honeypot || data.website) {
            console.log(`🚨 Bot detected from IP: ${clientIp}`);
            return json({ message: "OTP sent successfully" }, { status: 200 });
        }

        // OPTIMIZED: Early validation
        if (!phoneNumber) {
            return json({ message: "Phone number is required" }, { status: 400 });
        }

        if (!validatePhoneNumber(phoneNumber)) {
            return json({ 
                message: "Invalid phone number format. Use international format (e.g., +919876543210)",
                example: "+[country_code][number]"
            }, { status: 400 });
        }

        if (!['send', 'verify', 'register'].includes(action)) {
            return json({ message: "Invalid action" }, { status: 400 });
        }

        // ========================================
        // ACTION: SEND OTP
        // ========================================
        if (action === "send") {
            // OPTIMIZED: Check IP rate limit first (faster)
            const ipCheck = checkIpRateLimit(clientIp);
            if (!ipCheck.allowed) {
                console.log(`⚠️ IP rate limit: ${clientIp} - ${ipCheck.retryAfter}s`);
                return json({
                    message: ipCheck.reason,
                    retryAfter: ipCheck.retryAfter,
                    limitType: 'ip'
                }, { status: 429 });
            }

            // Check phone rate limit
            const rateCheck = checkOtpRateLimit(phoneNumber);
            if (!rateCheck.allowed) {
                console.log(`⚠️ Phone rate limit: ${mask(phoneNumber)} (${clientIp}) - ${rateCheck.limitType}`);
                return json({
                    message: rateCheck.reason,
                    retryAfter: rateCheck.retryAfter,
                    limitType: rateCheck.limitType,
                    usageStats: getUsageStats(phoneNumber)
                }, { status: 429 });
            }

            // OPTIMIZED: Fetch visitor with minimal fields
            const visitorList = await databases.listDocuments(
                DATABASE_ID,
                C.visitors,
                [
                    Query.equal("phone", phoneNumber),
                    Query.limit(1),
                    Query.select(['$id', 'phone', 'otpSentAt', 'isVerified', 'name', 'email'])
                ]
            );

            const isRegistered = visitorList.total > 0;
            const visitor = visitorList.documents[0];

            // 1-minute cooldown check
            if (isRegistered && visitor.otpSentAt) {
                const timeSinceLastOtp = Date.now() - new Date(visitor.otpSentAt).getTime();
                const cooldownMs = isTestMode() ? 5000 : 60000;
                if (timeSinceLastOtp < cooldownMs) {
                    const secondsRemaining = Math.ceil((cooldownMs - timeSinceLastOtp) / 1000);
                    return json({
                        message: `Please wait ${secondsRemaining} seconds before requesting a new OTP`,
                        retryAfter: secondsRemaining,
                        limitType: 'cooldown'
                    }, { status: 429 });
                }
            }

            // Generate OTP
            const generatedOtp = String(crypto.randomInt(1000, 10000));
            const now = new Date();
            const expiresAt = new Date(now.getTime() + 5 * 60 * 1000).toISOString();
            const sentAt = now.toISOString();

            console.log(`📱 Sending OTP to ${mask(phoneNumber)} from IP: ${clientIp}`);

            const otpData = {
                otpHash: hashOtp(phoneNumber, generatedOtp),
                otpExpiresAt: expiresAt,
                otpSentAt: sentAt,
                otpAttempts: 0
            };

            try {
                // OPTIMIZED: Database and SMS in parallel
                const [dbResult] = await Promise.all([
                    isRegistered
                        ? databases.updateDocument(DATABASE_ID, C.visitors, visitor.$id, otpData)
                        : databases.createDocument(DATABASE_ID, C.visitors, ID.unique(), {
                            phone: phoneNumber,
                            ...otpData,
                            isVerified: false
                        }),
                    deliverOtp(phoneNumber, generatedOtp).catch(err => {
                        throw new Error(`OTP delivery failed: ${err.message}`);
                    })
                ]);

                // Record successful request
                recordOtpRequest(phoneNumber, clientIp);
                const usageStats = getUsageStats(phoneNumber);

                console.log(`✅ OTP sent - ${usageStats.shortTermCount}/${usageStats.shortTermLimit} (10m), ${usageStats.dailyCount}/${usageStats.dailyLimit} (day) - IP: ${clientIp} - ${Date.now() - startTime}ms`);

                return json({
                    message: "OTP sent successfully",
                    isRegistered: !!(visitor?.name && visitor?.email),
                    usageStats,
                    // Only exposed while PUBLIC_SHOW_TEST_OTP=true (test mode)
                    ...(isTestMode() ? { otp: generatedOtp, testMode: true } : {})
                }, { status: 200 });

            } catch (err) {
                console.error(`❌ Send failed: ${err.message}`);
                
                // OPTIMIZED: Rollback only if DB succeeded but SMS failed
                if (err.message.includes('OTP delivery')) {
                    try {
                        if (isRegistered && visitor) {
                            await databases.updateDocument(DATABASE_ID, C.visitors, visitor.$id, {
                                otpHash: null, otpExpiresAt: null, otpSentAt: null
                            });
                        }
                    } catch (rollbackErr) {
                        console.error('Rollback failed:', rollbackErr);
                    }
                }
                
                return json({
                    message: "Failed to send OTP. Please try again"
                }, { status: 500 });
            }
        }

        // ========================================
        // ACTION: VERIFY OTP
        // ========================================
        if (action === "verify") {
            if (!otp || !/^\d{4}$/.test(otp)) {
                return json({ message: "Invalid OTP format. OTP must be 4 digits" }, { status: 400 });
            }

            // OPTIMIZED: Fetch with minimal fields
            const visitorList = await databases.listDocuments(
                DATABASE_ID,
                C.visitors,
                [
                    Query.equal("phone", phoneNumber), 
                    Query.limit(1),
                    Query.select(['$id', 'phone', 'otpHash', 'otpExpiresAt', 'otpAttempts', 'name', 'email'])
                ]
            );

            if (visitorList.total === 0) {
                return json({ message: "Phone number not found. Please request OTP first" }, { status: 404 });
            }

            const visitor = visitorList.documents[0];

            if (!visitor.otpHash) {
                return json({ message: "No OTP found. Please request a new one" }, { status: 400 });
            }

            // Check expiry
            if (Date.now() > new Date(visitor.otpExpiresAt).getTime()) {
                await databases.updateDocument(DATABASE_ID, C.visitors, visitor.$id, {
                    otpHash: null, otpExpiresAt: null, otpAttempts: 0
                });
                console.log(`⏰ Expired OTP: ${mask(phoneNumber)} - IP: ${clientIp}`);
                return json({ message: "OTP has expired. Please request a new one" }, { status: 401 });
            }

            // Check attempts
            const currentAttempts = visitor.otpAttempts || 0;
            if (currentAttempts >= 5) {
                await databases.updateDocument(DATABASE_ID, C.visitors, visitor.$id, {
                    otpHash: null, otpExpiresAt: null, otpAttempts: 0
                });
                console.log(`🚫 Max attempts: ${mask(phoneNumber)} - IP: ${clientIp}`);
                return json({ message: "Too many failed attempts. Please request a new OTP", maxAttempts: 5 }, { status: 429 });
            }

            // Verify OTP using constant-time comparison
            if (!safeEqual(visitor.otpHash, hashOtp(phoneNumber, otp))) {
                await databases.updateDocument(DATABASE_ID, C.visitors, visitor.$id, {
                    otpAttempts: currentAttempts + 1
                });
                console.log(`❌ Invalid OTP (${currentAttempts + 1}/5): ${mask(phoneNumber)} - IP: ${clientIp}`);
                return json({ 
                    message: "Invalid OTP. Please try again",
                    remainingAttempts: 5 - (currentAttempts + 1)
                }, { status: 401 });
            }

            // Success - clear OTP and mark verified
            await databases.updateDocument(DATABASE_ID, C.visitors, visitor.$id, {
                otpHash: null,
                otpExpiresAt: null,
                otpAttempts: 0,
                isVerified: true,
                lastVerifiedAt: new Date().toISOString()
            });

            console.log(`✅ Verified: ${mask(phoneNumber)} - IP: ${clientIp} - ${Date.now() - startTime}ms`);

            const session = await issueVisitorSession(phoneNumber);

            return json({
                message: "OTP verified successfully",
                isRegistered: !!(visitor.name && visitor.email),
                sessionToken: session.token,
                expiresAt: session.expiresAt
            }, { status: 200 });
        }

        // ========================================
        // ACTION: REGISTER
        // ========================================
        if (action === "register") {
            const { name, email, companyName, role, sessionToken } = data;

            if (!(await checkVisitorSession(sessionToken, phoneNumber))) {
                return json({ message: "Session expired. Please verify your phone number again" }, { status: 401 });
            }

            // OPTIMIZED: Inline validation
            if (!name || !email || !companyName) {
                return json({ message: "Name, email, and company name are required" }, { status: 400 });
            }

            if (!validateEmail(email)) {
                return json({ message: "Invalid email format" }, { status: 400 });
            }

            if (!validateName(name)) {
                return json({ message: "Invalid name. Must be at least 2 characters, no numbers" }, { status: 400 });
            }

            const visitorList = await databases.listDocuments(
                DATABASE_ID,
                C.visitors,
                [
                    Query.equal("phone", phoneNumber), 
                    Query.limit(1),
                    Query.select(['$id', 'isVerified', 'name', 'email'])
                ]
            );

            if (visitorList.total === 0) {
                return json({ message: "Phone number not verified. Please complete OTP verification first" }, { status: 400 });
            }

            const visitor = visitorList.documents[0];

            if (!visitor.isVerified) {
                return json({ message: "Phone number not verified. Please verify your phone number first" }, { status: 400 });
            }

            if (visitor.name && visitor.email) {
                return json({ message: "This phone number is already registered" }, { status: 400 });
            }

            await databases.updateDocument(DATABASE_ID, C.visitors, visitor.$id, {
                name: name.trim(),
                email: email.toLowerCase().trim(),
                companyName: companyName.trim(),
                role: role ? role.trim() : 'Visitor',
                isRegistered: true,
                registeredAt: new Date().toISOString()
            });

            console.log(`✅ Registered: ${name} (${mask(phoneNumber)}) - IP: ${clientIp} - ${Date.now() - startTime}ms`);

            return json({
                message: "Registration successful",
                isRegistered: true
            }, { status: 200 });
        }

    } catch (error) {
        console.error(`❌ OTP API error: ${error.message} - IP: ${clientIp} - ${Date.now() - startTime}ms`);
        return json({
            success: false,
            message: "Server error. Please try again"
        }, { status: 500 });
    }
}