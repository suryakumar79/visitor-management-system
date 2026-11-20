// src/routes/api/receptionists/reset-password/+server.js — admin: set a new password for a receptionist
import { json } from '@sveltejs/kit';
import * as store from '$lib/server/db.js';
import { C } from '$lib/collections.js';
import { guard, fail, clientIp } from '$lib/server/auth.js';

export async function POST(event) {
	const auth = guard(event, 'admin');
	if (auth.response) return auth.response;
	try {
		const { receptionistId, newPassword } = await event.request.json();
		if (!receptionistId || !newPassword) return fail(400, 'Missing required fields');
		const problem = store.passwordProblem(newPassword);
		if (problem) return fail(400, problem);

		const rec = await store.getDoc(C.receptionists, receptionistId);
		const user = rec.userId ? await store.getUser(rec.userId).catch(() => null) : await store.getUserByEmail(rec.email);
		if (!user) return fail(404, 'No login account found for this receptionist');
		const id = user.$id || user.id;

		await store.updateUser(id, { password: newPassword });
		await store.deleteAllSessions(id);
		await store.updateDoc(C.receptionists, receptionistId, { passwordLastReset: new Date().toISOString() });
		await store.audit('receptionist.password.reset', { actor: auth.user.email, target: rec.email, ip: clientIp(event) });
		return json({ success: true, message: 'Password reset successfully' });
	} catch (error) {
		console.error('Receptionist reset error:', error);
		return fail(Number.isInteger(error.code) ? error.code : 500, 'Password reset failed');
	}
}
