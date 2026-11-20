// src/routes/api/admin/users/+server.js — admin: list sign-in accounts
import { json } from '@sveltejs/kit';
import * as store from '$lib/server/db.js';
import { Query } from '$lib/query.js';
import { guard, fail } from '$lib/server/auth.js';

export async function GET(event) {
	const auth = guard(event, 'admin');
	if (auth.response) return auth.response;
	try {
		const list = await store.listUsers([Query.limit(200), Query.orderDesc('$createdAt')]);
		return json({ success: true, users: list.users, total: list.total });
	} catch (error) {
		console.error('List users failed:', error);
		return fail(500, 'Failed to fetch users');
	}
}
