// src/lib/server/auth.js — cookie sessions + role resolution
/** @typedef {{ $id: string, name: string, email: string, phone: string, labels: string[], sessionId: string, roles: { admin: boolean, hr: boolean, reception: boolean } }} SessionUser */
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import * as store from './db.js';
import { Query } from '$lib/query.js';
import { C } from '$lib/collections.js';

// "__Host-" cookies are only accepted over HTTPS, from this exact host, with Path=/ and no Domain.
const SECURE_NAME = '__Host-vms_session';
const PLAIN_NAME = 'vms_session';

const isSecure = (event) => event.url.protocol === 'https:';
const hours = () => Math.min(168, Math.max(1, Number(env.SESSION_HOURS) || 12));

export function setSessionCookie(event, token) {
	const secure = isSecure(event);
	event.cookies.set(secure ? SECURE_NAME : PLAIN_NAME, token, {
		path: '/', httpOnly: true, sameSite: 'strict', secure, maxAge: hours() * 3600
	});
}
export function clearSessionCookie(event) {
	for (const n of [SECURE_NAME, PLAIN_NAME]) event.cookies.delete(n, { path: '/' });
}

/** admin = label "admin"; hr = staff record with role HR; reception = receptionist record (same e-mail) */
export async function resolveRoles(user) {
	if (!user) return { admin: false, hr: false, reception: false };
	const [hr, rec] = await Promise.all([
		store.listDocs(C.staff, [Query.equal('email', user.email), Query.equal('role', 'HR'), Query.limit(1)]),
		store.listDocs(C.receptionists, [Query.equal('email', user.email), Query.limit(1)])
	]);
	return { admin: user.labels.includes('admin'), hr: hr.total > 0, reception: rec.total > 0 };
}

export async function currentUser(event) {
	const token = event.cookies.get(isSecure(event) ? SECURE_NAME : PLAIN_NAME);
	const user = await store.sessionUser(token);
	if (!user) return null;
	return { ...user, roles: await resolveRoles(user) };
}

export const fail = (status, message, extra = {}) => json({ success: false, message, error: message, code: status, ...extra }, { status });

/** Use inside +server.js: returns { user } or { response } */
export function guard(event, ...allowed) {
	const user = event.locals.user;
	if (!user) return { response: fail(401, 'Please sign in') };
	if (allowed.length && !allowed.some((r) => user.roles[r])) return { response: fail(403, 'You do not have access to this action') };
	return { user };
}

/** Real peer address (adapter-node honours ADDRESS_HEADER / XFF_DEPTH when behind a proxy). */
export function clientIp(event) {
	try { return event.getClientAddress(); } catch { return ''; }
}

/** Public-API throttle stored in the database. Returns a Response when blocked, otherwise null. */
export async function throttle(event, name, max, windowMs, keyExtra = '') {
	const r = await store.rateLimit(`${name}:${clientIp(event)}${keyExtra ? ':' + keyExtra : ''}`, max, windowMs);
	if (r.allowed) return null;
	return json({ success: false, message: `Too many requests. Please try again in ${r.retryAfter} seconds.`, retryAfter: r.retryAfter }, {
		status: 429, headers: { 'Retry-After': String(r.retryAfter) }
	});
}
