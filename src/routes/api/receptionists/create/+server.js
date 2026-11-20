// src/routes/api/receptionists/create/+server.js — admin: add a receptionist
import { json } from '@sveltejs/kit';
import * as store from '$lib/server/db.js';
import { Query } from '$lib/query.js';
import { C } from '$lib/collections.js';
import { guard, fail, clientIp } from '$lib/server/auth.js';
import { env } from '$env/dynamic/private';

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}$/;

export async function POST(event) {
	const auth = guard(event, 'admin');
	if (auth.response) return auth.response;
	try {
		const { name, email, departmentId, password } = await event.request.json();
		if (!name || !email || !departmentId || !password) return fail(400, 'Missing required fields');
		if (!EMAIL.test(email)) return fail(400, 'Invalid email format');
		const problem = store.passwordProblem(password);
		if (problem) return fail(400, problem);

		if ((await store.listDocs(C.receptionists, [Query.equal('email', email), Query.limit(1)])).total > 0) return fail(409, 'Email already exists');

		const user = await store.createUser({ email, password, name: String(name).slice(0, 100) });
		try {
			await store.addMembership(env.RECEPTIONIST_TEAM_ID || 'receptionist', user.$id, email, ['receptionist']);
			// no password (plain or hashed) is kept on the receptionist record
			const document = await store.createDoc(C.receptionists, 'unique()', {
				name: String(name).slice(0, 100), email: email.trim().toLowerCase(), departmentId,
				userId: user.$id, createdAt: new Date().toISOString()
			});
			await store.audit('receptionist.created', { actor: auth.user.email, target: email, ip: clientIp(event) });
			return json({ success: true, receptionist: document, message: `Receptionist ${name} added successfully.` });
		} catch (e) {
			await store.deleteUser(user.$id).catch(() => {}); // roll back
			throw e;
		}
	} catch (err) {
		console.error('Create receptionist error:', err);
		return fail(Number.isInteger(err.code) ? err.code : 500, `Could not create the receptionist: ${err.message}`);
	}
}
