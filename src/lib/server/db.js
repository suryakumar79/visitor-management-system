// src/lib/server/db.js
// ---------------------------------------------------------------------------
// Storage layer. Engine-neutral: the same code runs on SQLite (default) and
// PostgreSQL. Pick the engine with environment variables, see sql/index.js:
//
//     DATABASE_URL=postgres://user:pass@host:5432/vms   -> PostgreSQL
//     DB_PATH=./data/vms.db                             -> SQLite
//
// Layout
//   * each "collection" is a table  col_<name>(id, data JSON/JSONB, created_at, updated_at)
//   * real tables: users, auth_sessions, team_memberships, recovery_tokens,
//                  visitor_sessions, files, kv, rate_limits, audit_log
//   * every engine difference (JSON access, collation, types, locking) lives in
//     src/lib/server/sql/{sqlite,postgres}.js - nothing in this file is engine specific.
// ---------------------------------------------------------------------------
import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { env as priv } from '$env/dynamic/private';
import { ApiError, ID } from '$lib/query.js';
import { connectDriver } from './sql/index.js';
import { schemaStatements, collectionTableDDL } from './sql/schema.js';

const scrypt = promisify(crypto.scrypt);
const g = globalThis;
export const bus = (g.__vmsBus ??= Object.assign(new EventEmitter(), {}));
bus.setMaxListeners(0);

const nowIso = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// Connection + schema (idempotent: safe to run on every start)
// ---------------------------------------------------------------------------
async function open() {
	const d = await connectDriver(priv);
	for (const stmt of schemaStatements(d.dialect)) await d.exec(stmt);
	return d;
}

/** @returns {Promise<Awaited<ReturnType<typeof connectDriver>>>} */
const drv = () => (g.__vmsDriver ??= open());
export const engine = async () => (await drv()).dialect.name;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------
export const notFound = (what = 'Document') => new ApiError(`${what} not found`, 404, 'document_not_found');
export const conflict = (msg) => new ApiError(msg, 409, 'document_already_exists');
const bad = (msg, type = 'general_argument_invalid') => new ApiError(msg, 400, type);
const isDuplicate = (e) => /UNIQUE|duplicate key/i.test(String(e?.message));

// ---------------------------------------------------------------------------
// Query -> SQL (engine specific parts come from the dialect)
// ---------------------------------------------------------------------------
const META = { $id: 'id', $createdAt: 'created_at', $updatedAt: 'updated_at' };

function fieldFor(D, attr, cols) {
	if (META[attr]) return { kind: 'meta', sql: META[attr] };
	if (cols && cols[attr]) return { kind: 'column', sql: cols[attr] };
	if (typeof attr !== 'string' || !/^[\w$.\-]+$/.test(attr)) throw bad(`Invalid attribute "${attr}"`, 'general_query_invalid');
	return D.field(attr);
}

const likeEscape = (s) => String(s).replace(/[\\%_]/g, (c) => '\\' + c);

function parseQueries(queries) {
	return (queries || []).map((x) => {
		if (typeof x === 'string') {
			try { return JSON.parse(x); } catch { throw bad('Invalid query', 'general_query_invalid'); }
		}
		return x;
	});
}

function cond(D, q, cols, params) {
	const { method, values = [] } = q;
	if (method === 'or' || method === 'and') {
		const parts = values.map((s) => cond(D, s, cols, params)).filter(Boolean);
		if (!parts.length) return '1=1';
		return '(' + parts.join(method === 'or' ? ' OR ' : ' AND ') + ')';
	}
	const f = fieldFor(D, q.attribute, cols);
	switch (method) {
		case 'equal': return D.eqIn(f, values, params);
		case 'notEqual': return D.notEq(f, values, params);
		case 'lessThan': return D.cmp(f, '<', values[0], params);
		case 'lessThanEqual': return D.cmp(f, '<=', values[0], params);
		case 'greaterThan': return D.cmp(f, '>', values[0], params);
		case 'greaterThanEqual': return D.cmp(f, '>=', values[0], params);
		case 'between': return D.between(f, values[0], values[1], params);
		case 'startsWith': return D.like(f, likeEscape(values[0]) + '%', params);
		case 'endsWith': return D.like(f, '%' + likeEscape(values[0]), params);
		case 'contains':
		case 'search': {
			const parts = values.map((v) => D.like(f, '%' + likeEscape(v) + '%', params));
			return parts.length ? '(' + parts.join(' OR ') + ')' : '0=1';
		}
		case 'isNull': return D.isNull(f, false);
		case 'isNotNull': return D.isNull(f, true);
		default: return null;
	}
}

function buildQuery(D, queries, cols) {
	const params = [];
	const where = [];
	const order = [];
	let limit = 1000;
	let offset = 0;
	let select = null;
	for (const q of parseQueries(queries)) {
		if (!q || !q.method) continue;
		switch (q.method) {
			case 'limit': limit = Math.max(0, Math.min(5000, Number(q.values[0]) || 0)); break;
			case 'offset': offset = Math.max(0, Number(q.values[0]) || 0); break;
			case 'orderAsc': order.push(D.order(fieldFor(D, q.attribute, cols), 'ASC')); break;
			case 'orderDesc': order.push(D.order(fieldFor(D, q.attribute, cols), 'DESC')); break;
			case 'select': select = q.values; break;
			case 'cursorAfter':
			case 'cursorBefore': break;
			default: {
				const c = cond(D, q, cols, params);
				if (c) where.push(c);
			}
		}
	}
	return { whereSql: where.length ? 'WHERE ' + where.join(' AND ') : '', params, order, limit, offset, select };
}

// ---------------------------------------------------------------------------
// Generic document collections
// ---------------------------------------------------------------------------
const knownTables = new Set();

export async function tableFor(collectionId) {
	const name = String(collectionId || '').toLowerCase().replace(/[^a-z0-9_]/g, '_');
	if (!name) throw new ApiError('Collection id is required', 400, 'collection_not_found');
	const table = `col_${name}`;
	if (!knownTables.has(table)) {
		const d = await drv();
		await d.exec(collectionTableDDL(d.dialect, table));
		knownTables.add(table);
	}
	return table;
}

function rowToDoc(D, row, collectionId, select) {
	const data = D.parseJson(row.data) || {};
	let out = data;
	if (select && select.length && !select.includes('*')) {
		out = {};
		for (const k of select) if (k in data) out[k] = data[k];
	}
	return { ...out, $id: row.id, $createdAt: row.created_at, $updatedAt: row.updated_at, $collectionId: collectionId, $databaseId: 'vms', $permissions: [] };
}

const clean = (data) => {
	const out = {};
	for (const [k, v] of Object.entries(data || {})) {
		if (v === undefined || k.startsWith('$')) continue;
		out[k] = v;
	}
	return out;
};

function emit(collectionId, action, doc) {
	bus.emit('change', {
		channels: ['documents', `databases.vms.collections.${collectionId}.documents`, `databases.vms.collections.${collectionId}.documents.${doc.$id}`],
		events: [`databases.vms.collections.${collectionId}.documents.${doc.$id}.${action}`],
		payload: doc,
		timestamp: nowIso()
	});
}

export async function listDocs(collectionId, queries = []) {
	const d = await drv();
	const table = await tableFor(collectionId);
	const b = buildQuery(d.dialect, queries, null);
	const total = Number((await d.get(`SELECT COUNT(*) AS n FROM "${table}" ${b.whereSql}`, b.params)).n);
	const orderSql = b.order.length ? b.order.join(', ') : d.dialect.rowOrder + ' ASC';
	const rows = await d.all(`SELECT * FROM "${table}" ${b.whereSql} ORDER BY ${orderSql} LIMIT ? OFFSET ?`, [...b.params, b.limit, b.offset]);
	return { total, documents: rows.map((r) => rowToDoc(d.dialect, r, collectionId, b.select)) };
}

export async function getDoc(collectionId, id) {
	const d = await drv();
	const table = await tableFor(collectionId);
	const row = await d.get(`SELECT * FROM "${table}" WHERE id = ?`, [String(id)]);
	if (!row) throw notFound();
	return rowToDoc(d.dialect, row, collectionId);
}

export async function createDoc(collectionId, id, data) {
	const d = await drv();
	const table = await tableFor(collectionId);
	const docId = !id || id === 'unique()' ? ID.unique() : String(id);
	const ts = nowIso();
	try {
		await d.run(`INSERT INTO "${table}" (id, data, created_at, updated_at) VALUES (?, ${d.dialect.jsonParam}, ?, ?)`, [
			docId, JSON.stringify(clean(data)), ts, ts
		]);
	} catch (e) {
		if (isDuplicate(e)) throw conflict('Document with the requested ID already exists');
		throw e;
	}
	const doc = await getDoc(collectionId, docId);
	emit(collectionId, 'create', doc);
	return doc;
}

export async function updateDoc(collectionId, id, data) {
	const d = await drv();
	const table = await tableFor(collectionId);
	const existing = await getDoc(collectionId, id);
	const { $id, $createdAt, $updatedAt, $collectionId, $databaseId, $permissions, ...rest } = existing;
	const merged = { ...rest, ...clean(data) };
	await d.run(`UPDATE "${table}" SET data = ${d.dialect.jsonParam}, updated_at = ? WHERE id = ?`, [JSON.stringify(merged), nowIso(), String(id)]);
	const doc = await getDoc(collectionId, id);
	emit(collectionId, 'update', doc);
	return doc;
}

export async function deleteDoc(collectionId, id) {
	const d = await drv();
	const table = await tableFor(collectionId);
	const existing = await getDoc(collectionId, id);
	await d.run(`DELETE FROM "${table}" WHERE id = ?`, [String(id)]);
	emit(collectionId, 'delete', existing);
	return {};
}

/** Run fn while holding a named lock (single instance: in-process; PostgreSQL: advisory lock across instances). */
export async function withLock(key, fn) {
	return (await drv()).lock(key, fn);
}

// ---------------------------------------------------------------------------
// Passwords (scrypt, salted, non-blocking) + policy
// ---------------------------------------------------------------------------
const SCRYPT = { N: 16384, r: 8, p: 1 };

export async function hashPassword(password) {
	const salt = crypto.randomBytes(16);
	const hash = await scrypt(String(password), salt, 64, SCRYPT);
	return `scrypt$${SCRYPT.N}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
	try {
		const [alg, n, salt, hash] = String(stored).split('$');
		if (alg !== 'scrypt' || String(password).length > 256) return false;
		const known = Buffer.from(hash, 'hex');
		const test = await scrypt(String(password), Buffer.from(salt, 'hex'), known.length, { N: Number(n), r: SCRYPT.r, p: SCRYPT.p });
		return crypto.timingSafeEqual(known, test);
	} catch {
		return false;
	}
}

// a hash of nothing, so unknown e-mails cost the same time as wrong passwords
let dummyHash;
export async function burnPasswordTime(password) {
	dummyHash ??= await hashPassword(crypto.randomBytes(8).toString('hex'));
	await verifyPassword(password, dummyHash);
}

/** Returns a human readable problem or null. */
export function passwordProblem(pw) {
	const s = String(pw ?? '');
	if (s.length < 10) return 'Password must be at least 10 characters long';
	if (s.length > 128) return 'Password must be at most 128 characters long';
	if (!/[a-z]/i.test(s) || !/\d/.test(s)) return 'Password must contain letters and numbers';
	if (/^(.)\1+$/.test(s) || /password|123456|qwerty/i.test(s)) return 'That password is too easy to guess';
	return null;
}

export const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('hex');
export function safeEqual(a, b) {
	const x = Buffer.from(String(a ?? ''));
	const y = Buffer.from(String(b ?? ''));
	return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// ---------------------------------------------------------------------------
// Users / sessions / teams
// ---------------------------------------------------------------------------
const USER_COLS = { email: 'email', name: 'name', phone: 'phone', status: 'status', labels: 'labels' };
const normEmail = (e) => String(e || '').trim().toLowerCase();

function userRow(r) {
	return {
		$id: r.id, $createdAt: r.created_at, $updatedAt: r.updated_at,
		name: r.name, email: r.email, phone: r.phone, status: !!r.status,
		labels: JSON.parse(r.labels || '[]'),
		emailVerification: true, phoneVerification: false, registration: r.created_at, prefs: {}
	};
}

export async function listUsers(queries = []) {
	const d = await drv();
	const b = buildQuery(d.dialect, queries, USER_COLS);
	const total = Number((await d.get(`SELECT COUNT(*) AS n FROM users ${b.whereSql}`, b.params)).n);
	const rows = await d.all(`SELECT * FROM users ${b.whereSql} ORDER BY ${b.order.length ? b.order.join(', ') : 'created_at ASC'} LIMIT ? OFFSET ?`, [...b.params, b.limit, b.offset]);
	return { total, users: rows.map(userRow) };
}

export async function getUser(id) {
	const r = await (await drv()).get('SELECT * FROM users WHERE id = ?', [String(id)]);
	if (!r) throw notFound('User');
	return userRow(r);
}

/** raw row incl. password_hash (server use only) */
export async function getUserByEmail(email) {
	return (await (await drv()).get('SELECT * FROM users WHERE email = ?', [normEmail(email)])) || null;
}

export async function createUser({ id, email, phone = '', password, name = '', labels = [] }) {
	if (!email || !password) throw bad('Email and password are required');
	const problem = passwordProblem(password);
	if (problem) throw bad(problem, 'password_invalid');
	if (await getUserByEmail(email)) throw new ApiError('A user with the same email already exists', 409, 'user_already_exists');
	const uid = !id || id === 'unique()' ? ID.unique() : id;
	const ts = nowIso();
	const d = await drv();
	try {
		await d.run('INSERT INTO users (id, email, name, phone, password_hash, labels, status, created_at, updated_at) VALUES (?,?,?,?,?,?,1,?,?)', [
			uid, normEmail(email), name || '', phone || '', await hashPassword(password), JSON.stringify(labels), ts, ts
		]);
	} catch (e) {
		if (isDuplicate(e)) throw new ApiError('A user with the same email already exists', 409, 'user_already_exists');
		throw e;
	}
	return getUser(uid);
}

export async function updateUser(id, patch) {
	await getUser(id);
	const sets = [];
	const params = [];
	if (patch.name !== undefined) { sets.push('name = ?'); params.push(String(patch.name)); }
	if (patch.email !== undefined) { sets.push('email = ?'); params.push(normEmail(patch.email)); }
	if (patch.phone !== undefined) { sets.push('phone = ?'); params.push(String(patch.phone)); }
	if (patch.password !== undefined) {
		const problem = passwordProblem(patch.password);
		if (problem) throw bad(problem, 'password_invalid');
		sets.push('password_hash = ?'); params.push(await hashPassword(patch.password));
	}
	if (patch.labels !== undefined) { sets.push('labels = ?'); params.push(JSON.stringify(patch.labels)); }
	if (patch.status !== undefined) { sets.push('status = ?'); params.push(patch.status ? 1 : 0); }
	if (!sets.length) return getUser(id);
	sets.push('updated_at = ?'); params.push(nowIso());
	try {
		await (await drv()).run(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, [...params, String(id)]);
	} catch (e) {
		if (isDuplicate(e)) throw new ApiError('A user with the same email already exists', 409, 'user_already_exists');
		throw e;
	}
	return getUser(id);
}

export async function deleteUser(id) {
	await getUser(id);
	await (await drv()).run('DELETE FROM users WHERE id = ?', [String(id)]);
	return {};
}

export async function checkPassword(userId, password) {
	const r = await (await drv()).get('SELECT password_hash FROM users WHERE id = ?', [String(userId)]);
	return !!r && verifyPassword(password, r.password_hash);
}

function parseUa(ua = '') {
	const client = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Unknown browser';
	const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iOS/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Unknown OS';
	return { client, os, device: /Mobile|Android|iPhone/.test(ua) ? 'mobile' : 'desktop' };
}

const sessionHours = () => Math.min(168, Math.max(1, Number(priv.SESSION_HOURS) || 12));

export async function createSession(userId, { ip = '', userAgent = '' } = {}) {
	const token = randomToken(32);
	const id = ID.unique();
	const ua = parseUa(userAgent);
	const exp = new Date(Date.now() + sessionHours() * 3600000).toISOString();
	await (await drv()).run(
		'INSERT INTO auth_sessions (id, user_id, token_hash, ip, client_name, os_name, device_name, created_at, expires_at) VALUES (?,?,?,?,?,?,?,?,?)',
		[id, userId, sha256(token), ip, ua.client, ua.os, ua.device, nowIso(), exp]
	);
	return { token, id, expires: exp };
}

export async function sessionUser(token) {
	if (!token) return null;
	const d = await drv();
	const r = await d.get(`SELECT s.id AS sid, s.expires_at, u.* FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`, [sha256(token)]);
	if (!r) return null;
	if (new Date(r.expires_at) < new Date()) {
		await d.run('DELETE FROM auth_sessions WHERE id = ?', [r.sid]);
		return null;
	}
	if (!r.status) return null;
	return { ...userRow(r), sessionId: r.sid };
}

const sessionRow = (r, currentId) => ({
	$id: r.id, $createdAt: r.created_at, userId: r.user_id, expire: r.expires_at, ip: r.ip,
	clientName: r.client_name, osName: r.os_name, deviceName: r.device_name,
	countryName: r.ip && r.ip !== '127.0.0.1' && r.ip !== '::1' ? 'Remote' : 'Local network',
	current: r.id === currentId
});

export async function listSessions(userId, currentId = null) {
	const rows = await (await drv()).all('SELECT * FROM auth_sessions WHERE user_id = ? ORDER BY created_at DESC', [String(userId)]);
	return { total: rows.length, sessions: rows.map((r) => sessionRow(r, currentId)) };
}
export async function deleteSessionById(userId, sessionId) {
	await (await drv()).run('DELETE FROM auth_sessions WHERE user_id = ? AND id = ?', [String(userId), String(sessionId)]);
}
export async function deleteAllSessions(userId) {
	await (await drv()).run('DELETE FROM auth_sessions WHERE user_id = ?', [String(userId)]);
}

export async function createRecoveryToken(userId, minutes = 60) {
	const secret = randomToken(24);
	await (await drv()).run('INSERT INTO recovery_tokens (id, user_id, token_hash, expires_at) VALUES (?,?,?,?)', [
		ID.unique(), userId, sha256(secret), new Date(Date.now() + minutes * 60000).toISOString()
	]);
	return secret;
}

export async function consumeRecoveryToken(userId, secret) {
	const d = await drv();
	const r = await d.get('SELECT * FROM recovery_tokens WHERE user_id = ? AND token_hash = ? AND used = 0', [String(userId), sha256(secret)]);
	if (!r || new Date(r.expires_at) < new Date()) throw new ApiError('Invalid or expired recovery link', 401, 'user_invalid_token');
	await d.run('UPDATE recovery_tokens SET used = 1 WHERE id = ?', [r.id]);
}

// Teams
export async function addMembership(teamId, userId, email, roles = []) {
	try {
		const id = ID.unique();
		await (await drv()).run('INSERT INTO team_memberships (id, team_id, user_id, email, roles, created_at) VALUES (?,?,?,?,?,?)', [
			id, teamId, userId, email || '', JSON.stringify(roles), nowIso()
		]);
		return { $id: id, teamId, userId, userEmail: email, roles };
	} catch (e) {
		if (isDuplicate(e)) throw conflict('User is already a member of the team');
		throw e;
	}
}
export async function listMemberships(teamId) {
	const rows = await (await drv()).all('SELECT * FROM team_memberships WHERE team_id = ?', [String(teamId)]);
	return { total: rows.length, memberships: rows.map((r) => ({ $id: r.id, teamId: r.team_id, userId: r.user_id, userEmail: r.email, roles: JSON.parse(r.roles) })) };
}
export async function deleteMembership(teamId, membershipId) {
	await (await drv()).run('DELETE FROM team_memberships WHERE team_id = ? AND id = ?', [String(teamId), String(membershipId)]);
}

// ---------------------------------------------------------------------------
// Visitor sessions: issued only after a successful OTP check
// ---------------------------------------------------------------------------
const VISITOR_SESSION_MINUTES = 45;

export async function issueVisitorSession(phone) {
	const d = await drv();
	const token = randomToken(32);
	const expiresAtMs = Date.now() + VISITOR_SESSION_MINUTES * 60000;
	await d.run('DELETE FROM visitor_sessions WHERE expires_at < ?', [nowIso()]);
	await d.run('INSERT INTO visitor_sessions (token_hash, phone, expires_at, created_at) VALUES (?,?,?,?)', [sha256(token), String(phone), new Date(expiresAtMs).toISOString(), nowIso()]);
	return { token, expiresAt: expiresAtMs };
}

/** expiry (ms) when the token is valid for this phone, otherwise null */
export async function checkVisitorSession(token, phone) {
	if (!token || !phone) return null;
	const r = await (await drv()).get('SELECT phone, expires_at FROM visitor_sessions WHERE token_hash = ?', [sha256(token)]);
	if (!r || r.phone !== String(phone)) return null;
	const exp = new Date(r.expires_at).getTime();
	return exp > Date.now() ? exp : null;
}

// ---------------------------------------------------------------------------
// Rate limiting (stored in the database, so it survives restarts and works with several instances)
// ---------------------------------------------------------------------------
/** @returns {Promise<{allowed: boolean, retryAfter: number}>} */
export async function rateLimit(key, max, windowMs) {
	const d = await drv();
	const now = Date.now();
	const row = await d.get(
		`INSERT INTO rate_limits (key, hits, reset_at) VALUES (?, 1, ?)
		 ON CONFLICT (key) DO UPDATE SET
		   hits = CASE WHEN rate_limits.reset_at < ? THEN 1 ELSE rate_limits.hits + 1 END,
		   reset_at = CASE WHEN rate_limits.reset_at < ? THEN ? ELSE rate_limits.reset_at END
		 RETURNING hits, reset_at`,
		[key, now + windowMs, now, now, now + windowMs]
	);
	const hits = Number(row.hits);
	return { allowed: hits <= max, retryAfter: Math.max(1, Math.ceil((Number(row.reset_at) - now) / 1000)) };
}
/** Read-only check: has this key already used up its allowance? (does not count the call) */
export async function rateLimited(key, max) {
	const r = await (await drv()).get('SELECT hits, reset_at FROM rate_limits WHERE key = ?', [key]);
	if (!r || Number(r.reset_at) < Date.now() || Number(r.hits) < max) return { limited: false, retryAfter: 0 };
	return { limited: true, retryAfter: Math.max(1, Math.ceil((Number(r.reset_at) - Date.now()) / 1000)) };
}
export async function clearRateLimit(key) {
	await (await drv()).run('DELETE FROM rate_limits WHERE key = ?', [key]);
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------
export async function audit(action, { actor = '', target = '', ip = '', detail = '' } = {}) {
	try {
		await (await drv()).run('INSERT INTO audit_log (id, at, actor, action, target, ip, detail) VALUES (?,?,?,?,?,?,?)', [
			ID.unique(), nowIso(), String(actor).slice(0, 200), action, String(target).slice(0, 200), String(ip).slice(0, 64), String(detail).slice(0, 500)
		]);
	} catch (e) {
		console.error('[vms] audit write failed:', e.message);
	}
}
export async function listAudit({ limit = 200, offset = 0 } = {}) {
	const d = await drv();
	const total = Number((await d.get('SELECT COUNT(*) AS n FROM audit_log')).n);
	const rows = await d.all('SELECT id, at, actor, action, target, ip, detail FROM audit_log ORDER BY at DESC LIMIT ? OFFSET ?', [Math.min(limit, 500), offset]);
	return { total, entries: rows };
}

// ---------------------------------------------------------------------------
// Signed links (let a visitor see their own selfie without an account)
// ---------------------------------------------------------------------------
async function appSecret() {
	const d = await drv();
	let r = await d.get("SELECT value FROM kv WHERE key = 'app_secret'");
	if (!r) {
		await d.run("INSERT INTO kv (key, value) VALUES ('app_secret', ?) ON CONFLICT (key) DO NOTHING", [randomToken(32)]);
		r = await d.get("SELECT value FROM kv WHERE key = 'app_secret'");
	}
	return r.value;
}
/** 32-byte key for encrypting settings at rest (APP_SECRET env wins, otherwise a random secret kept in the database) */
export async function secretKey() {
	const base = priv.APP_SECRET || (await appSecret());
	return crypto.createHash('sha256').update('vms-settings|' + base).digest();
}
const sign = async (bucket, id, exp) => crypto.createHmac('sha256', await appSecret()).update(`${bucket}|${id}|${exp}`).digest('hex');

export async function signedFileUrl(bucket, id, minutes = 60) {
	const exp = Date.now() + minutes * 60000;
	return `/api/storage/${bucket}/${id}?exp=${exp}&sig=${await sign(bucket, id, exp)}`;
}
export async function validFileSignature(bucket, id, exp, sig) {
	if (!exp || !sig || Number(exp) < Date.now()) return false;
	return safeEqual(await sign(bucket, id, exp), sig);
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------
export async function saveFile(bucket, id, { name = 'file', mime = 'application/octet-stream', data }) {
	const fid = !id || id === 'unique()' ? ID.unique() : id;
	const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
	await (await drv()).run(
		`INSERT INTO files (bucket, id, name, mime, size, data, created_at) VALUES (?,?,?,?,?,?,?)
		 ON CONFLICT (bucket, id) DO UPDATE SET name = excluded.name, mime = excluded.mime, size = excluded.size, data = excluded.data`,
		[String(bucket), fid, name, mime, buf.length, buf, nowIso()]
	);
	return { $id: fid, bucketId: bucket, name, mimeType: mime, sizeOriginal: buf.length, $createdAt: nowIso() };
}
export async function readFile(bucket, id) {
	const r = await (await drv()).get('SELECT * FROM files WHERE bucket = ? AND id = ?', [String(bucket), String(id)]);
	if (!r) throw notFound('File');
	return { ...r, data: Buffer.from(r.data) };
}
export async function removeFile(bucket, id) {
	await (await drv()).run('DELETE FROM files WHERE bucket = ? AND id = ?', [String(bucket), String(id)]);
	return {};
}

// ---------------------------------------------------------------------------
// First start: create the first admin (no default passwords are shipped)
// ---------------------------------------------------------------------------
export async function seedIfEmpty(colls) {
	const d = await drv();
	if (Number((await d.get('SELECT COUNT(*) AS n FROM users')).n) > 0) return;
	const env = priv;
	const shown = [];
	const pick = (given, label, email) => {
		const password = given && !passwordProblem(given) ? given : randomToken(9) + 'aA1';
		shown.push(given && !passwordProblem(given) ? `${label}: ${email}  (password from SEED_*)` : `${label}: ${email}  password: ${password}`);
		return password;
	};

	const adminEmail = env.SEED_ADMIN_EMAIL || 'admin@example.com';
	await createUser({ email: adminEmail, password: pick(env.SEED_ADMIN_PASSWORD, 'Admin', adminEmail), name: 'System Admin', labels: ['admin'] });

	if (env.SEED_DEMO_DATA === 'false') {
		console.log(`\n[vms] First start - admin account created:\n  ${shown.join('\n  ')}\n  Change this password after signing in.\n`);
		return;
	}

	const dept = await createDoc(colls.departments, 'unique()', { name: 'Human Resources', description: 'HR department' });
	const dept2 = await createDoc(colls.departments, 'unique()', { name: 'Engineering', description: 'Engineering department' });
	const dept3 = await createDoc(colls.departments, 'unique()', { name: 'Sales', description: 'Sales department' });
	const pHr = await createDoc(colls.positions, 'unique()', { name: 'HR Manager', departmentId: dept.$id });
	const pEng = await createDoc(colls.positions, 'unique()', { name: 'Software Engineer', departmentId: dept2.$id });
	const pSales = await createDoc(colls.positions, 'unique()', { name: 'Sales Executive', departmentId: dept3.$id });

	const hrEmail = env.SEED_HR_EMAIL || 'hr@example.com';
	const hrUser = await createUser({ email: hrEmail, password: pick(env.SEED_HR_PASSWORD, 'HR', hrEmail), name: 'Demo HR' });
	const hrStaff = await createDoc(colls.staff, 'unique()', {
		name: 'Demo HR', email: hrEmail, phone: '+10000000001', employeeCode: 'EMP001',
		departmentId: dept.$id, positionId: pHr.$id, role: 'HR', status: 'active'
	});
	await addMembership(env.HR_TEAM_ID || 'hr', hrUser.$id, hrEmail, ['HR']);
	await createDoc(colls.hrCredentials, 'unique()', { staffId: hrStaff.$id, userId: hrUser.$id, email: hrEmail, hrPasswordLastReset: nowIso() });

	await createDoc(colls.staff, 'unique()', { name: 'Alex Morgan', email: 'alex@example.com', phone: '+10000000002', employeeCode: 'EMP002', departmentId: dept2.$id, positionId: pEng.$id, role: 'Staff', status: 'active' });
	await createDoc(colls.staff, 'unique()', { name: 'Sam Rivera', email: 'sam@example.com', phone: '+10000000003', employeeCode: 'EMP003', departmentId: dept3.$id, positionId: pSales.$id, role: 'Staff', status: 'active' });

	const recEmail = env.SEED_RECEPTIONIST_EMAIL || 'reception@example.com';
	const recUser = await createUser({ email: recEmail, password: pick(env.SEED_RECEPTIONIST_PASSWORD, 'Reception', recEmail), name: 'Front Desk' });
	await addMembership(env.RECEPTIONIST_TEAM_ID || 'receptionist', recUser.$id, recEmail, ['receptionist']);
	await createDoc(colls.receptionists, 'unique()', { name: 'Front Desk', email: recEmail, phone: '+10000000004', userId: recUser.$id, departmentId: null });

	console.log(`\n[vms] First start - demo accounts created (shown once, change them after signing in):\n  ${shown.join('\n  ')}\n`);
}
