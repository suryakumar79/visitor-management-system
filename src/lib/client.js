// src/lib/client.js
// Browser-side data client. Every call goes to this app's own API
// (/api/db, /api/auth, /api/storage, /api/events); the server checks the caller's role on each request.
import { C, SELFIE_BUCKET, DATABASE_ID } from '$lib/collections.js';
import { Query, ID, ApiError } from '$lib/query.js';

async function request(url, init = {}) {
	const isForm = init.body instanceof FormData;
	const res = await fetch(url, {
		credentials: 'same-origin',
		...init,
		headers: isForm ? init.headers : { 'Content-Type': 'application/json', ...(init.headers || {}) }
	});
	let data = null;
	try { data = await res.json(); } catch { /* empty body */ }
	if (!res.ok) throw new ApiError(data?.message || data?.error || res.statusText || 'Request failed', res.status, data?.type);
	return data;
}

const db = (body) => request('/api/db', { method: 'POST', body: JSON.stringify(body) });

export const databases = {
	listDocuments: (_dbId, collection, queries = []) => db({ op: 'list', collection, queries }),
	getDocument: (_dbId, collection, id) => db({ op: 'get', collection, id }),
	createDocument: (_dbId, collection, id, data) => db({ op: 'create', collection, id, data }),
	updateDocument: (_dbId, collection, id, data) => db({ op: 'update', collection, id, data }),
	deleteDocument: (_dbId, collection, id) => db({ op: 'delete', collection, id })
};

const post = (url, body) => request(url, { method: 'POST', body: JSON.stringify(body) });

export const account = {
	get: () => request('/api/auth/me'),
	createEmailPasswordSession: (email, password) => post('/api/auth/login', { email, password }),
	deleteSession: (sessionId = 'current') =>
		sessionId === 'current'
			? post('/api/auth/logout', {})
			: request('/api/auth/sessions', { method: 'DELETE', body: JSON.stringify({ sessionId }) }),
	listSessions: () => request('/api/auth/sessions'),
	updateName: (name) => post('/api/auth/profile', { field: 'name', value: name }),
	updateEmail: (email, password) => post('/api/auth/profile', { field: 'email', value: email, password }),
	updatePhone: (phone, password) => post('/api/auth/profile', { field: 'phone', value: phone, password }),
	updatePassword: (password, oldPassword) => post('/api/auth/profile', { field: 'password', value: password, password: oldPassword }),
	createRecovery: (email) => post('/api/auth/recovery-create', { email }),
	updateRecovery: (userId, secret, password) => post('/api/auth/recovery-confirm', { userId, secret, password })
};

export const storage = {
	createFile: async (bucketId, _id, file) => {
		const form = new FormData();
		form.append('file', file);
		return request(`/api/storage/${bucketId}`, { method: 'POST', body: form });
	},
	getFileView: (bucketId, id) => `${location.origin}/api/storage/${bucketId}/${id}`,
	deleteFile: (bucketId, id) => request(`/api/storage/${bucketId}/${id}`, { method: 'DELETE' })
};

export const functions = {
	createExecution: (functionId, body = '{}') => post(`/api/fn/${functionId}`, { body })
};

/** Live updates over server-sent events. */
function subscribe(channels, callback) {
	const list = Array.isArray(channels) ? channels : [channels];
	if (typeof EventSource === 'undefined') return () => {};
	const es = new EventSource(`/api/events?channels=${encodeURIComponent(list.join(','))}`);
	es.onmessage = (e) => {
		try { callback(JSON.parse(e.data)); } catch (err) { console.error('Realtime handler error', err); }
	};
	return () => es.close();
}
export const realtime = { subscribe };
export const client = { subscribe };

export { ID, Query };
export const VMS_DATABASE_ID = DATABASE_ID;
export const DEPARTMENTS_COLLECTION_ID = C.departments;
export const POSITIONS_COLLECTION_ID = C.positions;
export const STAFF_COLLECTION_ID = C.staff;
export const VISITORS_COLLECTION_ID = C.visitors;
export const VISITOR_LOGS_COLLECTION_ID = C.visitorLogs;
export const VISITOR_SELFIES_BUCKET_ID = SELFIE_BUCKET;
export const RECEPTIONIST_ID = C.receptionists;
export const ATTENDANCE_COLLECTION_ID = C.attendance;
export const HR_CREDENTIALS_COLLECTION_ID = C.hrCredentials;
export const SYSTEM_SETTINGS_COLLECTION_ID = C.systemSettings;
export const PREBOOKINGS_COLLECTION_ID = C.prebookings;
export const TEST_SETTINGS_FUNCTION_ID = 'test-settings';
