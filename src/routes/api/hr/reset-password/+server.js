// src/routes/api/hr/reset-password/+server.js — admin: set a new password for an HR login
import { json } from '@sveltejs/kit';
import * as store from '$lib/server/db.js';
import { C } from '$lib/collections.js';
import { guard, fail, clientIp } from '$lib/server/auth.js';

export async function POST(event) {
	const auth = guard(event, 'admin');
	if (auth.response) return auth.response;
	try {
		const { hrCredentialId, userId, newPassword } = await event.request.json();
		if (!hrCredentialId || !userId || !newPassword) return fail(400, 'Missing required fields');
		const problem = store.passwordProblem(newPassword);
		if (problem) return fail(400, problem);

		const cred = await store.getDoc(C.hrCredentials, hrCredentialId);
		if (cred.userId !== userId) return fail(400, 'Credential does not match this account');

		await store.updateUser(userId, { password: newPassword });
		await store.deleteAllSessions(userId);
		await store.updateDoc(C.hrCredentials, hrCredentialId, { hrPasswordLastReset: new Date().toISOString() });

		await store.audit('hr.password.reset', { actor: auth.user.email, target: cred.email, ip: clientIp(event) });
		return json({ success: true, message: 'Password reset successfully' });
	} catch (error) {
		console.error('Reset password error:', error);
		return fail(Number.isInteger(error.code) ? error.code : 500, `Password reset failed: ${error.message}`);
	}
}
