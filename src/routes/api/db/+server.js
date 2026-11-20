// src/routes/api/db/+server.js
// Single gateway the browser uses for document reads/writes .
// Every request is authorised here: nothing is readable/writable without the right role.
import { json } from '@sveltejs/kit';
import * as store from '$lib/server/db.js';
import { Query } from '$lib/query.js';
import { C } from '$lib/collections.js';
import { encryptSecret } from '$lib/server/secrets.js';

/** collection -> permission per role ('r' read, 'w' write incl. create/update/delete) */
const ROLE_POLICY = {
	hr: {
		[C.departments]: 'rw', [C.positions]: 'rw', [C.staff]: 'rw', [C.attendance]: 'rw',
		[C.visitors]: 'r', [C.visitorLogs]: 'rw', [C.prebookings]: 'rw', [C.emailRecipients]: 'r'
	},
	reception: {
		[C.visitorLogs]: 'rw', [C.visitors]: 'r', [C.prebookings]: 'rw',
		[C.staff]: 'r', [C.departments]: 'r', [C.positions]: 'r', [C.attendance]: 'r'
	}
};

// Visitors (not signed in) may only read the host directory, with safe fields only.
const PUBLIC_READ = new Set([C.departments, C.positions, C.staff, C.attendance]);
const PUBLIC_FIELDS = {
	[C.staff]: ['name', 'departmentId', 'positionId', 'employeeCode', 'status'],
	[C.attendance]: ['employeeCode', 'attendanceDate', 'status']
};
const SECRET_FIELDS = {
	[C.visitors]: ['otp', 'otpHash', 'otpExpiresAt', 'otpSentAt', 'otpAttempts'],
	[C.receptionists]: ['password']
};

const fail = (status, message) => json({ message, code: status, type: 'error' }, { status });

function allowed(user, collection, write) {
	if (user?.roles.admin) return true;
	if (user) {
		for (const role of ['hr', 'reception']) {
			if (user.roles[role]) {
				const p = ROLE_POLICY[role][collection];
				if (p && (!write || p.includes('w'))) return true;
			}
		}
		return false;
	}
	return !write && PUBLIC_READ.has(collection);
}

function strip(collection, doc, anonymous) {
	const out = { ...doc };
	// secret settings are write-only: the browser only learns whether a value is set
	if (collection === C.systemSettings && out.settingType === 'password') {
		out.hasValue = !!out.settingValue;
		out.settingValue = '';
	}
	for (const f of SECRET_FIELDS[collection] || []) delete out[f];
	if (anonymous && PUBLIC_FIELDS[collection]) {
		const keep = new Set([...PUBLIC_FIELDS[collection], '$id', '$createdAt', '$updatedAt']);
		for (const k of Object.keys(out)) if (!keep.has(k)) delete out[k];
	}
	return out;
}

export async function POST({ request, locals }) {
	const user = locals.user;
	let body;
	try { body = await request.json(); } catch { return fail(400, 'Invalid JSON'); }
	const { op, collection, id, data, queries } = body;

	if (!collection || typeof collection !== 'string') return fail(400, 'collection is required');
	if (!['list', 'get', 'create', 'update', 'delete'].includes(op)) return fail(400, 'Unknown operation');
	const write = !['list', 'get'].includes(op);
	if (!allowed(user, collection, write)) return fail(user ? 403 : 401, user ? 'Not allowed' : 'Please sign in');

	// Anonymous reads: active staff only
	let q = queries || [];
	const anon = !user;
	if (anon && collection === C.staff) q = [...q, Query.equal('status', 'active')];

	try {
		if (op === 'list') {
			const r = await store.listDocs(collection, q);
			return json({ total: r.total, documents: r.documents.map((d) => strip(collection, d, anon)) });
		}
		if (op === 'get') {
			if (anon) return fail(401, 'Please sign in');
			return json(strip(collection, await store.getDoc(collection, id), false));
		}
		if (write && collection === C.systemSettings && data && 'settingValue' in data) {
			const existing = op === 'update' ? await store.getDoc(collection, id) : null;
			const isSecret = (existing?.settingType || data.settingType) === 'password';
			if (isSecret) {
				if (data.settingValue === '' || data.settingValue == null) delete data.settingValue; // blank = keep current
				else data.settingValue = await encryptSecret(data.settingValue);
			}
		}
		if (write && collection === C.staff && !user.roles.admin) {
			// only an admin may grant or touch the HR role (prevents privilege escalation through the staff list)
			if (data && typeof data === 'object') delete data.role;
			if (op !== 'create') {
				const target = await store.getDoc(collection, id);
				if (target.role === 'HR') return fail(403, 'Only an admin can change an HR account');
			}
		}
		if (op === 'create') return json(strip(collection, await store.createDoc(collection, id, data), false));
		if (op === 'update') return json(strip(collection, await store.updateDoc(collection, id, data), false));
		if (op === 'delete') return json(await store.deleteDoc(collection, id));
	} catch (e) {
		return fail(Number.isInteger(e.code) ? e.code : 500, e.message || 'Database error');
	}
	return fail(400, 'Bad request');
}
