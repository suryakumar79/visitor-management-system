// src/routes/api/admin/reset-password/+server.js
import { json } from '@sveltejs/kit';
import * as store from '$lib/server/db.js';
import { Query } from '$lib/query.js';
import { C } from '$lib/collections.js';
import { throttle, clientIp } from '$lib/server/auth.js';

export async function POST(event) {
	try {
		const blocked = await throttle(event, 'admin-reset', 10, 15 * 60 * 1000);
		if (blocked) return blocked;
		const { token, password } = await event.request.json();
		if (!token || !password) return json({ error: 'Missing required fields' }, { status: 400 });
		const problem = store.passwordProblem(password);
		if (problem) return json({ error: problem }, { status: 400 });

		const found = await store.listDocs(C.passwordResets, [Query.equal('tokenHash', store.sha256(token)), Query.equal('used', false), Query.limit(1)]);
		const doc = found.documents[0];
		if (!doc) return json({ error: 'Invalid or expired reset link. Please request a new one.' }, { status: 401 });

		await store.updateDoc(C.passwordResets, doc.$id, { used: true }); // single use
		if (new Date() > new Date(doc.expiresAt)) return json({ error: 'This reset link has expired. Please request a new one.' }, { status: 401 });

		const user = await store.getUser(doc.userId);
		if (!user.labels.includes('admin')) return json({ error: 'Invalid or expired reset link.' }, { status: 401 });

		await store.updateUser(user.$id, { password });
		await store.deleteAllSessions(user.$id); // sign out everywhere after a reset
		await store.audit('admin.reset.completed', { actor: user.email, ip: clientIp(event) });
		return json({ message: 'Password reset successfully' });
	} catch (error) {
		console.error('Admin reset-password error:', error);
		return json({ error: 'An error occurred processing your request' }, { status: 500 });
	}
}
