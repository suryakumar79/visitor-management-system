// src/routes/api/fn/[id]/+server.js — admin tools (settings test messages)
import { json } from '@sveltejs/kit';
import { sendEmail, sendWebhook } from '$lib/server/notify.js';
import { guard, throttle } from '$lib/server/auth.js';

const reply = (status, body) => json({ responseStatusCode: status, responseBody: JSON.stringify(body) });
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}$/;

export async function POST(event) {
	if (event.params.id !== 'test-settings') return reply(404, { success: false, message: 'Unknown function' });

	const g = guard(event, 'admin');
	if (g.response) return reply(g.response.status, { success: false, message: 'Admin access required' });
	const blocked = await throttle(event, 'test-settings', 10, 10 * 60 * 1000, g.user.$id);
	if (blocked) return reply(429, { success: false, message: 'Too many tests. Please wait a few minutes.' });

	let payload = {};
	try {
		const raw = (await event.request.json()).body;
		payload = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw || {};
	} catch {
		return reply(400, { success: false, message: 'Invalid request body' });
	}

	if (payload.testType === 'email') {
		if (!EMAIL.test(String(payload.recipientEmail || ''))) return reply(400, { success: false, message: 'Enter a valid recipient email' });
		const r = await sendEmail({ to: payload.recipientEmail, subject: 'Test email', text: 'This is a test email from your Visitor Management System.' });
		if (r.error) return reply(502, { success: false, message: r.error });
		return reply(200, { success: true, simulated: r.simulated, message: r.simulated ? 'Logged to the server console (SMTP not configured or test mode)' : 'Email sent' });
	}

	if (payload.testType === 'webhook') {
		const r = await sendWebhook({ type: 'test', phone: String(payload.recipientPhone || '').slice(0, 20) });
		if (!r.success) return reply(502, { success: false, message: r.error || 'Webhook test failed' });
		return reply(200, { success: true, simulated: !!r.simulated });
	}

	return reply(400, { success: false, message: 'Unknown test type' });
}
