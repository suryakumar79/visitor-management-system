// src/routes/api/prebooking/+server.js
// Pre-booking with time slots.
//  - A booking reserves one slot with one host (capacity per slot is configurable).
//  - It also creates an *approved* visitor log for that day, so the normal visitor
//    pass + QR + reception check-in flow works unchanged on arrival.
import { json } from '@sveltejs/kit';
import crypto from 'node:crypto';
import * as store from '$lib/server/db.js';
import { Query } from '$lib/query.js';
import { C } from '$lib/collections.js';
import { getSettings, sendEmail, sendWebhook } from '$lib/server/notify.js';
import { throttle, clientIp } from '$lib/server/auth.js';
import { env } from '$env/dynamic/private';

const fail = (status, message, extra = {}) => json({ success: false, message, ...extra }, { status });

// ---- configuration (admin can override these in system_settings) -----------
async function getConfig() {
	const s = await getSettings();
	const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
	return {
		open: /^\d{2}:\d{2}$/.test(s.PREBOOK_OPEN || '') ? s.PREBOOK_OPEN : '09:00',
		close: /^\d{2}:\d{2}$/.test(s.PREBOOK_CLOSE || '') ? s.PREBOOK_CLOSE : '18:00',
		slotMinutes: num(s.PREBOOK_SLOT_MINUTES, 30),
		daysAhead: num(s.PREBOOK_DAYS_AHEAD, 14),
		capacity: num(s.PREBOOK_SLOT_CAPACITY, 1),
		maxActivePerVisitor: num(s.PREBOOK_MAX_ACTIVE, 3),
		workDays: (s.PREBOOK_WORK_DAYS || '1,2,3,4,5,6').split(',').map((x) => Number(x.trim())).filter((x) => x >= 0 && x <= 6)
	};
}

// ---- date helpers (server local time) ------------------------------------------
const pad = (n) => String(n).padStart(2, '0');
const dateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toMin = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const toHHMM = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const parseDate = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s || '') ? new Date(`${s}T00:00:00`) : null);

function dateProblem(date, cfg) {
	const d = parseDate(date);
	if (!d || isNaN(d)) return 'Please choose a valid date';
	const today = parseDate(dateStr(new Date()));
	if (d < today) return 'You cannot book a date in the past';
	if ((d.getTime() - today.getTime()) / 86400000 > cfg.daysAhead) return `Bookings open up to ${cfg.daysAhead} days ahead`;
	if (!cfg.workDays.includes(d.getDay())) return 'The office is closed on that day';
	return null;
}

function buildSlots(cfg) {
	const out = [];
	for (let m = toMin(cfg.open); m + cfg.slotMinutes <= toMin(cfg.close); m += cfg.slotMinutes) {
		out.push({ start: toHHMM(m), end: toHHMM(m + cfg.slotMinutes) });
	}
	return out;
}

async function activeBookings(extra) {
	return (await store.listDocs(C.prebookings, [Query.equal('status', 'booked'), Query.limit(2000), ...extra])).documents;
}

async function hostOnLeave(staff, date) {
	if (!staff.employeeCode) return false;
	const r = await store.listDocs(C.attendance, [
		Query.equal('attendanceDate', date), Query.equal('status', 'Absent'), Query.equal('employeeCode', staff.employeeCode), Query.limit(1)
	]);
	return r.total > 0;
}

async function slotsFor(staff, date, cfg) {
	const taken = new Map();
	for (const b of await activeBookings([Query.equal('staffId', staff.$id), Query.equal('slotDate', date)])) {
		taken.set(b.slotStart, (taken.get(b.slotStart) || 0) + 1);
	}
	const leave = await hostOnLeave(staff, date);
	const now = new Date();
	const isToday = date === dateStr(now);
	const nowMin = now.getHours() * 60 + now.getMinutes();
	return buildSlots(cfg).map((s) => {
		let reason = null;
		if (leave) reason = 'Host unavailable';
		else if (isToday && toMin(s.start) <= nowMin) reason = 'Time has passed';
		else if ((taken.get(s.start) || 0) >= cfg.capacity) reason = 'Booked';
		return { ...s, available: !reason, reason };
	});
}

async function requireVisitor(data) {
	const phone = data.visitorPhone || data.phone;
	if (!(await store.checkVisitorSession(data.sessionToken, phone))) {
		return { error: fail(401, 'Session expired. Please verify your phone number again.', { needsLogin: true }) };
	}
	return { phone };
}

async function getVisitor(phone) {
	return (await store.listDocs(C.visitors, [Query.equal('phone', phone), Query.limit(1)])).documents[0] || null;
}

async function getOrNull(coll, id) {
	try { return await store.getDoc(coll, id); } catch { return null; }
}

const publicBooking = (b) => ({
	id: b.$id, code: b.bookingCode, status: b.status, date: b.slotDate, start: b.slotStart, end: b.slotEnd,
	staffName: b.staffName, departmentName: b.departmentName, purpose: b.purpose, totalMembers: b.totalMembers, logId: b.logId
});

const isStaffUser = (u) => !!u && (u.roles.admin || u.roles.hr || u.roles.reception);

export async function POST(event) {
	let data;
	try { data = await event.request.json(); } catch { return fail(400, 'Invalid request'); }
	const { action } = data;
	const cfg = await getConfig();

	try {
		if (action === 'config') {
			return json({ success: true, config: { open: cfg.open, close: cfg.close, slotMinutes: cfg.slotMinutes, daysAhead: cfg.daysAhead, workDays: cfg.workDays, capacity: cfg.capacity } });
		}

		if (action === 'slots') {
			const blocked = await throttle(event, 'slots', 120, 10 * 60 * 1000);
			if (blocked) return blocked;
			const problem = dateProblem(data.date, cfg);
			if (problem) return fail(400, problem);
			const staff = await getOrNull(C.staff, data.staffId);
			if (!staff) return fail(404, 'Host not found');
			if (staff.status && staff.status !== 'active') return fail(400, 'This host is not available');
			return json({ success: true, date: data.date, slots: await slotsFor(staff, data.date, cfg) });
		}

		if (action === 'book') {
			const v = await requireVisitor(data);
			if (v.error) return v.error;
			const blocked = await throttle(event, 'book', 15, 60 * 60 * 1000);
			if (blocked) return blocked;
			const visitor = await getVisitor(v.phone);
			if (!visitor?.name || !visitor?.email) return fail(400, 'Please complete your registration first');

			const { staffId, date, start } = data;
			const purpose = String(data.purpose || '').trim().slice(0, 200);
			const members = Math.max(1, Math.min(50, parseInt(data.totalMembers, 10) || 1));
			if (purpose.length < 3) return fail(400, 'Please tell us the purpose of your visit');
			const problem = dateProblem(date, cfg);
			if (problem) return fail(400, problem);

			const staff = await getOrNull(C.staff, staffId);
			if (!staff) return fail(404, 'Host not found');
			if (staff.status && staff.status !== 'active') return fail(400, 'This host is not available');
			let departmentName = '';
			const dept = await getOrNull(C.departments, staff.departmentId);
			if (dept) departmentName = dept.name;

			// check + insert under one lock, so two visitors cannot take the same slot
			// (in-process on SQLite, a Postgres advisory lock when several instances run)
			const result = await store.withLock(`prebook:${date}`, async () => {
				const slot = (await slotsFor(staff, date, cfg)).find((s) => s.start === start);
				if (!slot) return { error: fail(400, 'That time slot does not exist') };
				if (!slot.available) return { error: fail(409, `That slot is no longer available (${slot.reason}). Please pick another.`) };

				const mine = (await activeBookings([Query.equal('visitorPhone', v.phone)])).filter((b) => b.slotDate >= dateStr(new Date()));
				if (mine.length >= cfg.maxActivePerVisitor) return { error: fail(400, `You can have at most ${cfg.maxActivePerVisitor} active bookings`) };
				if (mine.some((b) => b.slotDate === date && toMin(b.slotStart) < toMin(slot.end) && toMin(slot.start) < toMin(b.slotEnd))) {
					return { error: fail(409, 'You already have a booking at that time') };
				}

				const now = new Date().toISOString();
				const bookingCode = 'BK-' + crypto.randomBytes(4).toString('hex').toUpperCase();
				const log = await store.createDoc(C.visitorLogs, 'unique()', {
					visitorPhone: v.phone, visitorName: visitor.name, visitorEmail: visitor.email, companyName: visitor.companyName || '',
					departmentId: staff.departmentId, positionId: staff.positionId, staffId: staff.$id,
					staffName: staff.name, staffEmail: staff.email, staffPhone: staff.phone,
					purpose, totalMembers: members, productsDesc: 'N/A', selfieFileId: '',
					status: 'approved', requestTokenHash: store.sha256(crypto.randomUUID()), requestTime: now, requestTokenExpiresAt: now,
					approvalTime: now, approvedBy: 'Pre-booking', passDate: date,
					checkinTime: null, checkoutTime: null, rejectionReason: null,
					notes: `Pre-booked ${slot.start}-${slot.end}`, isPrebooked: true, slotStart: slot.start, slotEnd: slot.end
				});
				const booking = await store.createDoc(C.prebookings, 'unique()', {
					bookingCode, status: 'booked', visitorPhone: v.phone, visitorName: visitor.name, visitorEmail: visitor.email,
					companyName: visitor.companyName || '', staffId: staff.$id, staffName: staff.name, departmentId: staff.departmentId,
					departmentName, purpose, totalMembers: members, slotDate: date, slotStart: slot.start, slotEnd: slot.end, logId: log.$id
				});
				await store.updateDoc(C.visitorLogs, log.$id, { bookingId: booking.$id });
				return { booking, log, slot, bookingCode };
			});
			if (result.error) return result.error;
			const { booking, log, slot, bookingCode } = result;
			await store.audit('booking.created', { actor: visitor.email, target: bookingCode, ip: clientIp(event) });

			// notifications (best effort, never block the response)
			const base = env.FRONTEND_BASE_URL || event.url.origin;
			const passUrl = `${base}/visitor/pass?logId=${log.$id}`;
			sendEmail({
				to: visitor.email, subject: `Visit booked: ${date} ${slot.start} with ${staff.name}`,
				text: `Hello ${visitor.name},\n\nYour visit is booked.\n\nWhen: ${date}, ${slot.start}-${slot.end}\nWith: ${staff.name}${departmentName ? ' (' + departmentName + ')' : ''}\nBooking code: ${bookingCode}\n\nShow your pass at the reception: ${passUrl}\n\n---\nVisitor Management System`
			});
			sendEmail({
				to: staff.email, subject: `Visitor booked: ${visitor.name} on ${date} ${slot.start}`,
				text: `Hello ${staff.name},\n\n${visitor.name} (${visitor.companyName || 'no company'}) has booked a visit.\n\nWhen: ${date}, ${slot.start}-${slot.end}\nPurpose: ${purpose}\nMembers: ${members}\n\n---\nVisitor Management System`
			});
			sendWebhook({ type: 'booking.confirmed', phone: v.phone, host: staff.name, date, time: slot.start, bookingCode });

			return json({ success: true, booking: publicBooking(booking), passUrl: `/visitor/pass?logId=${log.$id}` });
		}

		if (action === 'mine') {
			const v = await requireVisitor(data);
			if (v.error) return v.error;
			const rows = (await store.listDocs(C.prebookings, [Query.equal('visitorPhone', v.phone), Query.orderDesc('slotDate'), Query.limit(50)])).documents;
			return json({ success: true, bookings: rows.map(publicBooking) });
		}

		if (action === 'cancel') {
			const booking = await getOrNull(C.prebookings, data.bookingId);
			if (!booking) return fail(404, 'Booking not found');

			let actor;
			if (data.sessionToken !== undefined) {
				const v = await requireVisitor(data);
				if (v.error) return v.error;
				if (booking.visitorPhone !== v.phone) return fail(403, 'This is not your booking');
				actor = booking.visitorEmail;
			} else {
				if (!isStaffUser(event.locals.user)) return fail(401, 'Please sign in');
				actor = event.locals.user.email;
			}
			if (booking.status !== 'booked') return fail(400, `This booking is already ${booking.status}`);
			const logDoc = booking.logId ? await getOrNull(C.visitorLogs, booking.logId) : null;
			if (logDoc && ['checked-in', 'partial-checkout', 'checked-out'].includes(logDoc.status)) return fail(400, 'The visitor has already checked in');

			await store.updateDoc(C.prebookings, booking.$id, { status: 'cancelled', cancelledAt: new Date().toISOString() });
			if (logDoc) await store.updateDoc(C.visitorLogs, logDoc.$id, { status: 'rejected', rejectionReason: 'Booking cancelled' });
			await store.audit('booking.cancelled', { actor, target: booking.bookingCode, ip: clientIp(event) });
			return json({ success: true });
		}

		if (action === 'adminList') {
			if (!isStaffUser(event.locals.user)) return fail(401, 'Please sign in');
			const q = [Query.orderAsc('slotDate'), Query.orderAsc('slotStart'), Query.limit(500)];
			if (data.date) q.push(Query.equal('slotDate', String(data.date)));
			if (data.from) q.push(Query.greaterThanEqual('slotDate', String(data.from)));
			const rows = (await store.listDocs(C.prebookings, q)).documents;
			const today = dateStr(new Date());
			const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
			const bookings = [];
			for (const b of rows) {
				const log = b.logId ? await getOrNull(C.visitorLogs, b.logId) : null;
				let state = b.status;
				if (b.status === 'booked' && log) {
					if (['checked-in', 'partial-checkout'].includes(log.status)) state = 'checked-in';
					else if (log.status === 'checked-out') state = 'completed';
					else if (b.slotDate < today || (b.slotDate === today && toMin(b.slotEnd) < nowMin)) state = 'no-show';
				}
				bookings.push({ ...publicBooking(b), state, visitorName: b.visitorName, visitorPhone: b.visitorPhone, companyName: b.companyName, staffId: b.staffId });
			}
			return json({ success: true, bookings });
		}

		return fail(400, 'Invalid action');
	} catch (error) {
		console.error('Prebooking error:', error);
		return fail(500, 'Something went wrong. Please try again.');
	}
}
