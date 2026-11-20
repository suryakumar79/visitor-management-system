#!/usr/bin/env node
// End-to-end smoke test against a running server. Works on SQLite and PostgreSQL.
//
//   npm run dev                       (or `node build`) in one terminal, with PUBLIC_SHOW_TEST_OTP=true
//   BASE=http://localhost:5173 ADMIN_EMAIL=... ADMIN_PASSWORD=... HR_EMAIL=... HR_PASSWORD=... \
//   REC_EMAIL=... REC_PASSWORD=... node scripts/smoke-test.mjs
//
// It creates a few throw-away records (visitors, one test collection) and cleans up what it can.
const BASE = process.env.BASE || 'http://localhost:5173';
const need = (k) => { if (!process.env[k]) { console.error(`Set ${k}`); process.exit(2); } return process.env[k]; };
const ADMIN = { email: need('ADMIN_EMAIL'), password: need('ADMIN_PASSWORD') };
const HR = { email: need('HR_EMAIL'), password: need('HR_PASSWORD') };
const REC = { email: need('REC_EMAIL'), password: need('REC_PASSWORD') };

let passed = 0, failed = 0;
const ok = (cond, name, extra = '') => {
	if (cond) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); }
};

class Client {
	cookies = new Map();
	async req(path, { method = 'GET', body, headers = {}, raw } = {}) {
		const h = { ...headers };
		if (this.cookies.size) h.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
		if (body && !raw) h['content-type'] = 'application/json';
		h.origin ??= BASE;
		const res = await fetch(BASE + path, { method, headers: h, body: raw ? body : body ? JSON.stringify(body) : undefined, redirect: 'manual' });
		for (const c of res.headers.getSetCookie?.() || []) {
			const [pair] = c.split(';');
			const i = pair.indexOf('=');
			const k = pair.slice(0, i), v = pair.slice(i + 1);
			if (/Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(c) || v === '') this.cookies.delete(k); else this.cookies.set(k, v);
		}
		let data = null;
		const ct = res.headers.get('content-type') || '';
		if (ct.includes('json')) data = await res.json().catch(() => null);
		return { status: res.status, data, headers: res.headers, res };
	}
	login(c) { return this.req('/api/auth/login', { method: 'POST', body: c }); }
	db(op, collection, extra = {}) { return this.req('/api/db', { method: 'POST', body: { op, collection, ...extra } }); }
}

const Q = {
	equal: (a, v) => ({ method: 'equal', attribute: a, values: Array.isArray(v) ? v : [v] }),
	gt: (a, v) => ({ method: 'greaterThan', attribute: a, values: [v] }),
	lte: (a, v) => ({ method: 'lessThanEqual', attribute: a, values: [v] }),
	between: (a, x, y) => ({ method: 'between', attribute: a, values: [x, y] }),
	starts: (a, v) => ({ method: 'startsWith', attribute: a, values: [v] }),
	contains: (a, v) => ({ method: 'contains', attribute: a, values: [v] }),
	isNull: (a) => ({ method: 'isNull', attribute: a, values: [] }),
	or: (list) => ({ method: 'or', values: list }),
	asc: (a) => ({ method: 'orderAsc', attribute: a, values: [] }),
	desc: (a) => ({ method: 'orderDesc', attribute: a, values: [] }),
	limit: (n) => ({ method: 'limit', values: [n] })
};

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const rnd = () => Math.random().toString(36).slice(2, 8);
const phoneN = () => '+9198' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');

async function visitorLogin(phone) {
	const v = new Client();
	const s = await v.req('/api/otp', { method: 'POST', body: { action: 'send', phoneNumber: phone } });
	if (!s.data?.otp) throw new Error('OTP not returned - run the server with PUBLIC_SHOW_TEST_OTP=true');
	const r = await v.req('/api/otp', { method: 'POST', body: { action: 'verify', phoneNumber: phone, otp: s.data.otp } });
	return { v, token: r.data.sessionToken, registered: r.data.isRegistered };
}

async function main() {
	console.log(`Smoke test against ${BASE}\n`);

	console.log('Security headers & CSRF');
	const home = new Client();
	const h = await home.req('/');
	ok(h.status === 200, 'home page loads');
	ok(/default-src 'self'/.test(h.headers.get('content-security-policy') || ''), 'Content-Security-Policy is set');
	ok(h.headers.get('x-frame-options') === 'DENY', 'X-Frame-Options DENY');
	ok(h.headers.get('x-content-type-options') === 'nosniff', 'nosniff');
	ok(!/googleapis|jsdelivr|qrserver|cloudflare/.test(await h.res.text()), 'no third-party hosts on the home page');
	const csrf = await home.req('/api/auth/login', { method: 'POST', body: ADMIN, headers: { origin: 'https://evil.example' } });
	ok(csrf.status === 403, 'cross-origin POST is blocked', `got ${csrf.status}`);

	console.log('\nSign-in');
	const admin = new Client(), hr = new Client(), rec = new Client();
	ok((await admin.login(ADMIN)).status === 200, 'admin signs in');
	ok((await hr.login(HR)).status === 200, 'HR signs in');
	ok((await rec.login(REC)).status === 200, 'receptionist signs in');
	const me = await admin.req('/api/auth/me');
	ok(me.data?.roles?.admin === true && !('password_hash' in (me.data || {})), 'admin role resolved, no hash exposed');
	ok((await new Client().login({ email: ADMIN.email, password: 'wrong-password-1' })).status === 401, 'wrong password is rejected');
	const cookieNames = [...admin.cookies.keys()];
	ok(cookieNames.length === 1 && /vms_session$/.test(cookieNames[0]), 'one session cookie');

	console.log('\nAccess control');
	const anon = new Client();
	ok((await anon.db('list', 'visitors', { queries: [] })).status === 401, 'visitors table closed to the public');
	ok((await anon.db('list', 'system_settings', { queries: [] })).status === 401, 'settings closed to the public');
	const pubStaff = await anon.db('list', 'staff', { queries: [] });
	ok(pubStaff.status === 200 && pubStaff.data.documents.every((d) => !('email' in d) && !('phone' in d)), 'public host list hides e-mail and phone');
	ok((await hr.db('list', 'system_settings', { queries: [] })).status === 403, 'HR cannot read settings');
	ok((await hr.req('/api/hr/create', { method: 'POST', body: {} })).status === 403, 'HR cannot call admin API');
	ok((await rec.req('/api/admin/users')).status === 403, 'receptionist cannot list users');
	ok((await anon.req('/api/admin/users')).status === 401, 'anonymous cannot list users');
	ok((await anon.req('/api/receptionists/dashboard', { method: 'POST', body: { action: 'getStats' } })).status === 401, 'dashboard needs a login');
	const staffList = await admin.db('list', 'staff', { queries: [Q.limit(50)] });
	const plainHr = staffList.data.documents.find((d) => d.role !== 'HR');
	if (plainHr) {
		await hr.db('update', 'staff', { id: plainHr.$id, data: { role: 'HR' } }).catch(() => {});
		const upd = await hr.db('update', 'staff', { id: plainHr.$id, data: { role: 'HR', phone: plainHr.phone } });
		const after = await admin.db('get', 'staff', { id: plainHr.$id });
		ok(after.data.role !== 'HR', 'HR cannot promote someone to HR', `status ${upd.status}`);
	}
	const hrCred = await admin.db('list', 'hr_credentials', { queries: [] });
	ok(!JSON.stringify(hrCred.data).match(/PlainPassword|password"/i), 'no password stored in hr_credentials');
	const recs = await admin.db('list', 'receptionists', { queries: [] });
	ok(!JSON.stringify(recs.data).match(/plainPassword|"password"/), 'no password stored for receptionists');

	console.log('\nQuery engine (same results on SQLite and PostgreSQL)');
	const coll = 'smoke_' + rnd();
	const rows = [
		{ name: 'Alpha', n: 5, ok: true, tag: 'x-ray', when: '2026-01-05' },
		{ name: 'beta', n: 10, ok: false, tag: 'yankee', when: '2026-02-01' },
		{ name: 'Charlie', n: 9, ok: true, tag: null, when: '2026-03-15' },
		{ name: 'delta', n: 100, ok: false, tag: 'x-ray', when: '2026-04-20' }
	];
	for (const r of rows) await admin.db('create', coll, { id: 'unique()', data: r });
	const names = async (queries) => (await admin.db('list', coll, { queries })).data.documents.map((d) => d.name).join(',');
	ok((await names([Q.asc('n')])) === 'Alpha,Charlie,beta,delta', 'numeric ordering (5 < 9 < 10 < 100)', await names([Q.asc('n')]));
	ok((await names([Q.desc('name')])) === 'delta,Charlie,beta,Alpha', 'case-insensitive text ordering', await names([Q.desc('name')]));
	ok((await names([Q.gt('n', 9), Q.asc('n')])) === 'beta,delta', 'greaterThan on numbers');
	ok((await names([Q.between('n', 5, 9), Q.asc('n')])) === 'Alpha,Charlie', 'between on numbers');
	ok((await names([Q.equal('ok', true), Q.asc('n')])) === 'Alpha,Charlie', 'equal on booleans');
	ok((await names([Q.equal('name', 'ALPHA')])) === 'Alpha', 'case-insensitive equal');
	ok((await names([Q.starts('tag', 'x'), Q.asc('n')])) === 'Alpha,delta', 'startsWith');
	ok((await names([Q.contains('name', 'harl')])) === 'Charlie', 'contains');
	ok((await names([Q.isNull('tag')])) === 'Charlie', 'isNull');
	ok((await names([Q.or([Q.equal('name', 'beta'), Q.gt('n', 50)]), Q.asc('n')])) === 'beta,delta', 'or');
	ok((await names([Q.lte('when', '2026-02-01'), Q.asc('when')])) === 'Alpha,beta', 'string/date comparison');
	const lim = await admin.db('list', coll, { queries: [Q.asc('n'), Q.limit(2)] });
	ok(lim.data.documents.length === 2 && lim.data.total === 4, 'limit keeps the full total');
	const upd = await admin.db('update', coll, { id: lim.data.documents[0].$id, data: { n: 7 } });
	ok(upd.data.n === 7 && upd.data.name === 'Alpha', 'partial update merges fields');

	console.log('\nVisitor flow');
	const phone = phoneN();
	const a = await visitorLogin(phone);
	ok(!!a.token && !a.registered, 'OTP login issues a session');
	const badOtp = await a.v.req('/api/otp', { method: 'POST', body: { action: 'verify', phoneNumber: phone, otp: '0000' } });
	ok(badOtp.status === 401 || badOtp.status === 400, 'a used OTP cannot be reused', `got ${badOtp.status}`);
	ok((await a.v.req('/api/visitor-operations', { method: 'POST', body: { action: 'getVisitorData', phone } })).status === 401, 'visitor data needs the session token');
	const reg = await a.v.req('/api/otp', { method: 'POST', body: { action: 'register', phoneNumber: phone, sessionToken: a.token, name: 'Test Visitor', email: `v-${rnd()}@example.com`, companyName: 'Example Co' } });
	ok(reg.status === 200, 'registration works with the session', `got ${reg.status}`);
	const visitorsAdmin = await admin.db('list', 'visitors', { queries: [Q.equal('phone', phone)] });
	ok(visitorsAdmin.data.documents.length === 1 && !('otp' in visitorsAdmin.data.documents[0]) && !('otpHash' in visitorsAdmin.data.documents[0]), 'OTP never leaves the server');

	console.log('\nUploads');
	const up = async (buf, type, name) => {
		const f = new FormData();
		f.append('file', new Blob([buf], { type }), name);
		return anon.req('/api/storage/visitor_selfies', { method: 'POST', body: f, raw: true });
	};
	const good = await up(png, 'image/png', 's.png');
	ok(good.status === 200 && good.data.$id, 'PNG selfie accepted');
	ok((await up(Buffer.from('<svg onload=alert(1)>'), 'image/png', 'x.png')).status === 415, 'fake image (wrong bytes) rejected');
	ok((await up(Buffer.from('hello'), 'text/plain', 'x.txt')).status === 415, 'non-image rejected');
	ok((await anon.req(`/api/storage/visitor_selfies/${good.data.$id}`)).status === 401, 'selfie not public');
	ok((await admin.req(`/api/storage/visitor_selfies/${good.data.$id}`)).status === 200, 'selfie visible to staff');

	console.log('\nPre-booking');
	const staffDirect = (await a.v.req('/api/visitor-operations', { method: 'POST', body: { action: 'getCheckinData', phone, sessionToken: a.token } })).data;
	const host = staffDirect.staff[0];
	ok(!('email' in host) && !('phone' in host), 'host contact details are not sent to visitors');
	const day = new Date(); day.setDate(day.getDate() + 1); while (day.getDay() === 0) day.setDate(day.getDate() + 1);
	const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
	const book = (c, tok, ph, start) => c.req('/api/prebooking', { method: 'POST', body: { action: 'book', visitorPhone: ph, sessionToken: tok, staffId: host.id, date, start, purpose: 'Smoke test', totalMembers: 1 } });
	const b1 = await book(a.v, a.token, phone, '16:00');
	ok(b1.status === 200 && b1.data.booking?.code, 'booking created', JSON.stringify(b1.data));
	// three more visitors race for one slot: exactly one may win
	const racers = [];
	for (let i = 0; i < 3; i++) {
		const p = phoneN();
		const x = await visitorLogin(p);
		await x.v.req('/api/otp', { method: 'POST', body: { action: 'register', phoneNumber: p, sessionToken: x.token, name: 'Racer ' + 'ABC'[i], email: `r${i}-${rnd()}@example.com`, companyName: 'Race Co' } });
		racers.push({ ...x, p });
	}
	const results = await Promise.all(racers.map((r) => book(r.v, r.token, r.p, '16:30')));
	ok(results.filter((r) => r.status === 200).length === 1, 'parallel bookings of one slot: exactly one wins', results.map((r) => r.status).join(','));
	ok((await book(a.v, a.token, phone, '16:00')).status === 409, 'same slot cannot be booked twice');
	ok((await book(a.v, a.token, phone, '03:00')).status === 400, 'slot outside opening hours rejected');
	const mine = await a.v.req('/api/prebooking', { method: 'POST', body: { action: 'mine', visitorPhone: phone, sessionToken: a.token } });
	ok(mine.data.bookings.length === 1, 'visitor sees their booking');
	const list = await rec.req('/api/prebooking', { method: 'POST', body: { action: 'adminList', date } });
	ok(list.status === 200 && list.data.bookings.length >= 2, 'reception sees bookings');
	ok((await anon.req('/api/prebooking', { method: 'POST', body: { action: 'adminList' } })).status === 401, 'bookings hidden from the public');
	const other = racers.find((_, i) => results[i].status !== 200);
	ok((await other.v.req('/api/prebooking', { method: 'POST', body: { action: 'cancel', visitorPhone: other.p, sessionToken: other.token, bookingId: b1.data.booking.id } })).status === 403, "cannot cancel someone else's booking");
	ok((await a.v.req('/api/prebooking', { method: 'POST', body: { action: 'cancel', visitorPhone: phone, sessionToken: a.token, bookingId: b1.data.booking.id } })).status === 200, 'cancel works');
	ok((await book(a.v, a.token, phone, '16:00')).status === 200, 'cancelled slot can be booked again');

	console.log('\nWalk-in check-in, host approval, reception');
	const dept = staffDirect.staff.find((s) => s.id === host.id);
	const co = await a.v.req('/api/visitor-checkin', { method: 'POST', body: { action: 'checkin', sessionToken: a.token, visitorPhone: phone, visitorName: 'Test Visitor', visitorEmail: 'v@example.com', companyName: 'Example Co', departmentId: dept.departmentId, positionId: dept.positionId, staffId: host.id, purpose: 'Smoke', totalMembers: 1, selfieFileId: good.data.$id } });
	ok(co.status === 200 && co.data.logId, 'check-in request created', JSON.stringify(co.data));
	const noSess = await new Client().req('/api/visitor-checkin', { method: 'POST', body: { action: 'checkin', visitorPhone: phone, visitorName: 'X', visitorEmail: 'x@example.com', companyName: 'C', departmentId: dept.departmentId, positionId: dept.positionId, staffId: host.id, purpose: 'x', totalMembers: 1, selfieFileId: good.data.$id } });
	ok(noSess.status === 401, 'check-in without a verified session is refused');
	const token = new URL(co.data.testApprovalUrl).searchParams.get('token');
	const staffSess = await anon.req('/api/visitor-checkin', { method: 'POST', body: { action: 'createStaffSession', logId: co.data.logId, requestToken: token } });
	ok(staffSess.status === 200, 'host opens the approval link');
	ok((await anon.req('/api/visitor-checkin', { method: 'POST', body: { action: 'createStaffSession', logId: co.data.logId, requestToken: 'not-the-token' } })).status === 401, 'wrong approval token refused');
	const appr = await anon.req('/api/visitor-checkin', { method: 'POST', body: { action: 'updateStatus', sessionToken: staffSess.data.sessionToken, logId: co.data.logId, newStatus: 'approved' } });
	ok(appr.status === 200, 'host approves');
	const scan = await rec.req('/api/receptionists/dashboard', { method: 'POST', body: { action: 'processQRScan', logId: co.data.logId } });
	ok(scan.data?.success === true, 'reception scans the pass');
	const cin = await rec.req('/api/receptionists/dashboard', { method: 'POST', body: { action: 'checkin', logId: co.data.logId, memberCount: 1, receptionistId: 'x', receptionistName: 'Desk' } });
	ok(cin.data?.success === true, 'reception checks the visitor in');
	const cout = await rec.req('/api/receptionists/dashboard', { method: 'POST', body: { action: 'checkout', logId: co.data.logId, memberCount: 1, receptionistId: 'x', receptionistName: 'Desk' } });
	ok(cout.data?.success === true, 'reception checks the visitor out');

	console.log('\nAccounts & audit');
	const meRec = await rec.req('/api/receptionists/me');
	ok(meRec.status === 200 && meRec.data.session?.email === REC.email.toLowerCase(), 'receptionist profile endpoint');
	const audit = await admin.req('/api/admin/audit?limit=50');
	ok(audit.status === 200 && audit.data.entries.some((e) => e.action === 'login.ok') && audit.data.entries.some((e) => e.action === 'login.failed'), 'audit log records sign-ins');
	ok((await hr.req('/api/admin/audit')).status === 403, 'audit log is admin only');
	const pw = await admin.req('/api/auth/profile', { method: 'POST', body: { field: 'password', value: 'short', password: ADMIN.password } });
	ok(pw.status === 400, 'weak new password refused');
	const out = await rec.req('/api/auth/logout', { method: 'POST', body: {} });
	ok(out.status === 200 && (await rec.req('/api/auth/me')).status === 401, 'sign-out ends the session');

	console.log(`\n${passed} passed, ${failed} failed`);
	process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
