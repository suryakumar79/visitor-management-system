// src/routes/api/admin/sessions/terminate/+server.js — admin: sign a user out of one session
import { json } from '@sveltejs/kit';
import * as store from '$lib/server/db.js';
import { guard, fail, clientIp } from '$lib/server/auth.js';

export async function POST(event) {
	const auth = guard(event, 'admin');
	if (auth.response) return auth.response;
	try {
		const { userId, sessionId } = await event.request.json();
		if (!userId || !sessionId) return fail(400, 'User ID and Session ID are required');
		const sessions = (await store.listSessions(userId)).sessions;
		if (!sessions.some((s) => s.$id === sessionId)) return fail(404, 'Session not found for this user');
		await store.deleteSessionById(userId, sessionId);
		await store.audit('session.terminated', { actor: auth.user.email, target: userId, ip: clientIp(event) });
		return json({ success: true, message: 'Session terminated successfully' });
	} catch (error) {
		console.error('Terminate session failed:', error);
		return fail(500, 'Failed to terminate the session');
	}
}
