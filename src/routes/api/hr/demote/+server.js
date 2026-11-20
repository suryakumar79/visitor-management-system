// src/routes/api/hr/demote/+server.js — admin: remove HR access
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
		const { staffDocumentId, userId } = await event.request.json();
		if (!staffDocumentId || !userId) return fail(400, 'Missing required fields');
		if (userId === auth.user.$id) return fail(400, 'You cannot remove your own account');

		const staff = await store.getDoc(C.staff, staffDocumentId);
		const target = await store.getUser(userId).catch(() => null);
		if (target && target.email.toLowerCase() !== String(staff.email || '').toLowerCase()) {
			return fail(400, 'That account does not belong to this staff member');
		}
		if (target?.labels.includes('admin')) return fail(400, 'Admin accounts cannot be removed here');

		await store.updateDoc(C.staff, staffDocumentId, { role: 'Staff' });

		const creds = await store.listDocs(C.hrCredentials, [Query.equal('staffId', staffDocumentId), Query.limit(5)]);
		for (const c of creds.documents) await store.deleteDoc(C.hrCredentials, c.$id);

		const team = env.HR_TEAM_ID || 'hr';
		for (const m of (await store.listMemberships(team)).memberships.filter((m) => m.userId === userId)) {
			await store.deleteMembership(team, m.$id);
		}
		if (target) await store.deleteUser(userId); // also ends all of their sessions

		await store.audit('hr.removed', { actor: auth.user.email, target: staff.email, ip: clientIp(event) });
		return json({ success: true, message: 'HR staff demoted to general staff. HR access removed.' });
	} catch (error) {
		console.error('Demote HR error:', error);
		return fail(Number.isInteger(error.code) ? error.code : 500, `Demotion failed: ${error.message}`);
	}
}
