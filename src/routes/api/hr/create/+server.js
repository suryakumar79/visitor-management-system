// src/routes/api/hr/create/+server.js — admin: give a staff member an HR login
import { json } from '@sveltejs/kit';
import * as store from '$lib/server/db.js';
import { Query } from '$lib/query.js';
import { C } from '$lib/collections.js';
import { guard, fail, clientIp } from '$lib/server/auth.js';
import { env } from '$env/dynamic/private';

export async function POST(event) {
	const auth = guard(event, 'admin');
	if (auth.response) return auth.response;
	try {
		const { staffDocumentId, email, password } = await event.request.json();
		if (!staffDocumentId || !email || !password) return fail(400, 'Missing required fields');
		const problem = store.passwordProblem(password);
		if (problem) return fail(400, problem);

		const staff = await store.getDoc(C.staff, staffDocumentId);
		if (String(staff.email || '').toLowerCase() !== String(email).trim().toLowerCase()) {
			return fail(400, 'The e-mail must match the staff member\'s record');
		}

		let user = await store.getUserByEmail(email);
		let userId;
		if (user) {
			userId = user.id;
			await store.updateUser(userId, { password });
			await store.deleteAllSessions(userId);
		} else {
			userId = (await store.createUser({ email, password, name: staff.name || String(email).split('@')[0] })).$id;
		}

		try {
			await store.addMembership(env.HR_TEAM_ID || 'hr', userId, email, ['HR']);
		} catch (e) {
			if (e.code !== 409) throw e;
		}

		await store.updateDoc(C.staff, staffDocumentId, { role: 'HR' });

		// no password is ever stored in the database - only the time it was set
		const existing = await store.listDocs(C.hrCredentials, [Query.equal('staffId', staffDocumentId), Query.limit(1)]);
		const data = { staffId: staffDocumentId, userId: userId, email, hrPasswordLastReset: new Date().toISOString() };
		if (existing.documents.length) await store.updateDoc(C.hrCredentials, existing.documents[0].$id, data);
		else await store.createDoc(C.hrCredentials, 'unique()', data);

		await store.audit('hr.granted', { actor: auth.user.email, target: email, ip: clientIp(event) });
		return json({ success: true, message: 'HR staff created/promoted successfully.', userId }, { status: 201 });
	} catch (error) {
		console.error('Create HR error:', error);
		return fail(Number.isInteger(error.code) ? error.code : 500, `Promotion failed: ${error.message}`);
	}
}
