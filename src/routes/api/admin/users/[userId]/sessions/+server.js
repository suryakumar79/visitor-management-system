// src/routes/api/admin/users/[userId]/sessions/+server.js — admin: a user's active sessions
import { json } from '@sveltejs/kit';
import * as store from '$lib/server/db.js';
import { guard, fail } from '$lib/server/auth.js';

export async function GET(event) {
	const auth = guard(event, 'admin');
	if (auth.response) return auth.response;
	try {
		const list = await store.listSessions(event.params.userId);
		return json({ success: true, sessions: list.sessions });
	} catch (error) {
		console.error('List sessions failed:', error);
		return fail(500, 'Failed to fetch sessions');
	}
}
