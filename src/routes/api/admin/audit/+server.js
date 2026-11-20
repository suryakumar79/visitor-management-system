// src/routes/api/admin/audit/+server.js — admin: security audit trail
import { json } from '@sveltejs/kit';
import * as store from '$lib/server/db.js';
import { guard } from '$lib/server/auth.js';

export async function GET(event) {
	const auth = guard(event, 'admin');
	if (auth.response) return auth.response;
	const limit = Math.min(Number(event.url.searchParams.get('limit')) || 100, 500);
	const offset = Math.max(Number(event.url.searchParams.get('offset')) || 0, 0);
	return json({ success: true, ...(await store.listAudit({ limit, offset })) });
}
