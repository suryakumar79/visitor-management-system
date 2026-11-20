// src/routes/api/receptionists/delete/+server.js — admin: remove a receptionist and their login
import { json } from '@sveltejs/kit';
import * as store from '$lib/server/db.js';
import { C } from '$lib/collections.js';
import { guard, fail, clientIp } from '$lib/server/auth.js';
import { env } from '$env/dynamic/private';

export async function POST(event) {
	const auth = guard(event, 'admin');
	if (auth.response) return auth.response;
	try {
		const { receptionistId } = await event.request.json();
		if (!receptionistId) return fail(400, 'Missing receptionist ID');

		const rec = await store.getDoc(C.receptionists, receptionistId);
		await store.deleteDoc(C.receptionists, receptionistId);

		// the login account is found from the record itself, never from a value sent by the browser
		const userId = rec.userId;
		if (userId && userId !== auth.user.$id) {
			const team = env.RECEPTIONIST_TEAM_ID || 'receptionist';
			for (const m of (await store.listMemberships(team)).memberships.filter((m) => m.userId === userId)) await store.deleteMembership(team, m.$id);
			await store.deleteUser(userId).catch(() => {});
		}
		await store.audit('receptionist.deleted', { actor: auth.user.email, target: rec.email, ip: clientIp(event) });
		return json({ success: true, message: 'Receptionist deleted successfully' });
	} catch (err) {
		console.error('Delete receptionist error:', err);
		return fail(Number.isInteger(err.code) ? err.code : 500, 'Could not delete the receptionist');
	}
}
