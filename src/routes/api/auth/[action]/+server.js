// src/routes/api/auth/[action]/+server.js — sign-in, sessions, profile, password recovery
import { json } from '@sveltejs/kit';
import * as store from '$lib/server/db.js';
import { isTestMode, sendEmail } from '$lib/server/notify.js';
import { setSessionCookie, clearSessionCookie, clientIp, fail, throttle } from '$lib/server/auth.js';

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}$/;
const WINDOW = 10 * 60 * 1000;

export async function GET(event) {
	const { action } = event.params;
	const user = event.locals.user;
	if (!user) return fail(401, 'Not signed in');
	if (action === 'me') return json(user);
	if (action === 'sessions') return json(await store.listSessions(user.$id, user.sessionId));
	return fail(404, 'Unknown action');
}

export async function DELETE(event) {
	if (event.params.action !== 'sessions') return fail(404, 'Unknown action');
	const user = event.locals.user;
	if (!user) return fail(401, 'Not signed in');
	const { sessionId } = await event.request.json().catch(() => ({}));
	if (!sessionId) return fail(400, 'sessionId required');
	await store.deleteSessionById(user.$id, sessionId);
	await store.audit('session.revoked', { actor: user.email, target: sessionId, ip: clientIp(event) });
	if (sessionId === user.sessionId) clearSessionCookie(event);
	return json({ success: true });
}

export async function POST(event) {
	const { action } = event.params;
	const body = await event.request.json().catch(() => ({}));
	const user = event.locals.user;
	const ip = clientIp(event);

	if (action === 'login') {
		const email = String(body.email || '').trim().toLowerCase().slice(0, 320);
		const password = String(body.password || '');
		// Two independent limits on FAILED attempts: per address and per account
		// (stops password spraying and targeted guessing, without locking out a busy office behind one address)
		const ipKey = `login-ip:${ip}`;
		const acctKey = `login-acct:${ip}:${email}`;
		const [ipState, acctState] = [await store.rateLimited(ipKey, 30), await store.rateLimited(acctKey, 8)];
		if (ipState.limited || acctState.limited) {
			await store.audit('login.blocked', { actor: email, ip });
			const wait = Math.max(ipState.retryAfter, acctState.retryAfter);
			return fail(429, `Too many failed attempts. Please try again in ${Math.ceil(wait / 60)} minute(s).`, { retryAfter: wait });
		}
		const row = email && password.length <= 256 ? await store.getUserByEmail(email) : null;
		const ok = row && row.status ? await store.verifyPassword(password, row.password_hash) : (await store.burnPasswordTime(password), false);
		if (!ok) {
			await store.rateLimit(ipKey, 30, WINDOW);
			await store.rateLimit(acctKey, 8, WINDOW);
			await store.audit('login.failed', { actor: email, ip });
			return fail(401, 'Invalid email or password');
		}
		await store.clearRateLimit(acctKey);
		// new session id on every login (prevents session fixation)
		const old = event.cookies.get('vms_session') || event.cookies.get('__Host-vms_session');
		if (old) { const u = await store.sessionUser(old); if (u) await store.deleteSessionById(u.$id, u.sessionId); }
		const s = await store.createSession(row.id, { ip, userAgent: event.request.headers.get('user-agent') || '' });
		setSessionCookie(event, s.token);
		await store.audit('login.ok', { actor: email, ip });
		return json({ $id: s.id, userId: row.id, expire: s.expires });
	}

	if (action === 'logout') {
		if (user) {
			await store.deleteSessionById(user.$id, user.sessionId);
			await store.audit('logout', { actor: user.email, ip });
		}
		clearSessionCookie(event);
		return json({ success: true });
	}

	if (action === 'profile') {
		if (!user) return fail(401, 'Not signed in');
		const { field, value, password } = body;
		try {
			if (field === 'name') {
				await store.updateUser(user.$id, { name: String(value || '').trim().slice(0, 100) });
			} else if (field === 'email' || field === 'phone' || field === 'password') {
				const blocked = await throttle(event, 'profile', 10, WINDOW, user.$id);
				if (blocked) return blocked;
				if (!(await store.checkPassword(user.$id, password))) return fail(401, 'Current password is incorrect');
				if (field === 'email') {
					if (!EMAIL.test(String(value))) return fail(400, 'Invalid email address');
					await store.updateUser(user.$id, { email: String(value).trim() });
				} else if (field === 'phone') {
					await store.updateUser(user.$id, { phone: String(value || '').trim().slice(0, 30) });
				} else {
					await store.updateUser(user.$id, { password: value });
					for (const s of (await store.listSessions(user.$id)).sessions) if (s.$id !== user.sessionId) await store.deleteSessionById(user.$id, s.$id);
				}
				await store.audit(`profile.${field}.changed`, { actor: user.email, ip });
			} else return fail(400, 'Unknown field');
		} catch (e) {
			return fail(Number.isInteger(e.code) ? e.code : 500, e.message);
		}
		return json({ success: true });
	}

	if (action === 'recovery-create') {
		const blocked = (await throttle(event, 'recovery', 5, WINDOW)) || null;
		if (blocked) return blocked;
		const email = String(body.email || '').trim().toLowerCase();
		const row = EMAIL.test(email) ? await store.getUserByEmail(email) : null;
		// identical answer whether or not the account exists
		if (row && row.status) {
			const secret = await store.createRecoveryToken(row.id);
			// the link always points at this site, never at a caller-supplied address
			const link = `${event.url.origin}/hr/reset-password?userId=${row.id}&secret=${secret}`;
			await store.audit('recovery.requested', { actor: email, ip });
			const mail = await sendEmail({
				to: row.email, subject: 'Reset your password',
				text: `Use this link to choose a new password (valid for 1 hour):\n${link}\n\nIf you did not ask for this, ignore this message.`
			});
			return json({ success: true, ...(isTestMode() && mail.simulated ? { testLink: link } : {}) });
		}
		return json({ success: true });
	}

	if (action === 'recovery-confirm') {
		const blocked = await throttle(event, 'recovery-confirm', 10, WINDOW);
		if (blocked) return blocked;
		try {
			await store.consumeRecoveryToken(body.userId, body.secret);
			await store.updateUser(body.userId, { password: body.password });
			await store.deleteAllSessions(body.userId);
			await store.audit('recovery.completed', { target: body.userId, ip });
			return json({ success: true });
		} catch (e) {
			return fail(Number.isInteger(e.code) ? e.code : 400, e.message);
		}
	}

	return fail(404, 'Unknown action');
}
