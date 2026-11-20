// src/routes/api/admin/forgot-password/+server.js
// Password reset by e-mail for admin accounts. The answer is identical whether or not the account exists.
import { json } from '@sveltejs/kit';
import * as store from '$lib/server/db.js';
import { C } from '$lib/collections.js';
import { sendEmail, isTestMode } from '$lib/server/notify.js';
import { throttle, clientIp } from '$lib/server/auth.js';

const GENERIC = 'If an admin account exists for that address, a reset link has been sent.';
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}$/;

export async function POST(event) {
	try {
		const blocked = (await throttle(event, 'admin-forgot', 5, 15 * 60 * 1000)) || null;
		if (blocked) return blocked;
		const { email } = await event.request.json();
		const addr = String(email || '').trim().toLowerCase();
		if (!EMAIL.test(addr)) return json({ error: 'Please enter a valid email address' }, { status: 400 });

		const row = await store.getUserByEmail(addr);
		if (!row || !row.status || !JSON.parse(row.labels || '[]').includes('admin')) return json({ message: GENERIC });

		const token = store.randomToken(24);
		await store.createDoc(C.passwordResets, 'unique()', {
			userId: row.id,
			tokenHash: store.sha256(token), // only the hash is stored
			expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
			used: false,
			createdAt: new Date().toISOString()
		});

		const resetURL = `${event.url.origin}/admin/reset-password?token=${token}`;
		await store.audit('admin.reset.requested', { actor: addr, ip: clientIp(event) });
		const mail = await sendEmail({
			to: row.email,
			subject: 'Password reset request',
			text: `We received a request to reset your admin password.\n\nReset it here (valid for 1 hour):\n${resetURL}\n\nIf this was not you, ignore this message.`
		});
		return json({ message: isTestMode() && mail.simulated ? `${GENERIC} (Test mode) Reset link: ${resetURL}` : GENERIC });
	} catch (error) {
		console.error('Admin forgot-password error:', error);
		return json({ error: 'An error occurred. Please try again later.' }, { status: 500 });
	}
}
