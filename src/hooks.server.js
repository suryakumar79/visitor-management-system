// src/hooks.server.js — runs on every request: CSRF check, session, security headers.
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { currentUser } from '$lib/server/auth.js';
import { seedIfEmpty } from '$lib/server/db.js';
import { ensureDefaultSettings } from '$lib/server/defaults.js';
import { C } from '$lib/collections.js';

// Create the first admin on an empty database. Failing to start loudly beats a half-working app.
const ready = seedIfEmpty({
	departments: C.departments, positions: C.positions, staff: C.staff,
	hrCredentials: C.hrCredentials, receptionists: C.receptionists
}).then(() => ensureDefaultSettings()).catch((e) => { console.error('[vms] Database initialisation failed:', e); throw e; });

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const extraOrigins = () => (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);

/** @type {import('@sveltejs/kit').Handle} */
export async function handle({ event, resolve }) {
	await ready;

	// CSRF: a state-changing request must come from this site (browsers always send Origin on such requests)
	if (UNSAFE.has(event.request.method)) {
		const origin = event.request.headers.get('origin');
		const site = event.request.headers.get('sec-fetch-site');
		if ((origin && origin !== event.url.origin && !extraOrigins().includes(origin)) || site === 'cross-site') {
			return json({ success: false, message: 'Cross-site request blocked' }, { status: 403 });
		}
	}

	try { event.locals.ip = event.getClientAddress(); } catch { event.locals.ip = ''; }
	event.locals.user = await currentUser(event);

	const res = await resolve(event);

	const h = res.headers;
	h.set('X-Content-Type-Options', 'nosniff');
	h.set('X-Frame-Options', 'DENY');
	h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	h.set('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(), payment=(), usb=()');
	h.set('Cross-Origin-Opener-Policy', 'same-origin');
	h.set('Cross-Origin-Resource-Policy', 'same-origin');
	if (event.url.protocol === 'https:') h.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
	// never cache API answers or signed-in pages in shared caches
	if (event.url.pathname.startsWith('/api/') || event.locals.user) h.set('Cache-Control', 'no-store');
	return res;
}

/** Never leak stack traces or internals to the browser. */
export function handleError({ error, event }) {
	console.error(`[vms] ${event.request.method} ${event.url.pathname}:`, error);
	return { message: 'Something went wrong' };
}
