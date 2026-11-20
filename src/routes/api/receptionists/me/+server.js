// src/routes/api/receptionists/me/+server.js — the signed-in receptionist's record
import { json } from '@sveltejs/kit';
import * as store from '$lib/server/db.js';
import { Query } from '$lib/query.js';
import { C } from '$lib/collections.js';
import { guard } from '$lib/server/auth.js';

export async function GET(event) {
	const auth = guard(event, 'reception');
	if (auth.response) return auth.response;
	const rec = (await store.listDocs(C.receptionists, [Query.equal('email', auth.user.email), Query.limit(1)])).documents[0];
	if (!rec) return json({ success: false, message: 'Not a receptionist account' }, { status: 403 });
	return json({
		success: true,
		session: { id: rec.$id, name: rec.name, email: rec.email, departmentId: rec.departmentId || null, userId: auth.user.$id }
	});
}
