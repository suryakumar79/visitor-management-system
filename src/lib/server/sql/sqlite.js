// SQLite driver (Node's built-in node:sqlite - nothing to compile).
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { makeMutex } from './mutex.js';

const q = (attr) => `json_extract(data, '$."${attr}"')`;
const bind = (v) => (v === undefined ? null : v);

/** SQL differences between engines live here, so db.js stays engine-neutral. */
export const dialect = {
	name: 'sqlite',
	types: { blob: 'BLOB', big: 'INTEGER', seq: '' },
	jsonParam: '?',
	rowOrder: 'rowid',
	parseJson: (v) => (typeof v === 'string' ? JSON.parse(v) : v),
	toParam: (v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v),
	// field = { sql, kind: 'meta' | 'column' | 'doc' }
	field: (name) => ({ kind: 'doc', name, sql: q(name) }),
	eqIn(f, vals, params) {
		const nonNull = vals.filter((v) => v !== null && v !== undefined);
		const parts = [];
		const col = f.kind === 'meta' ? f.sql : `${f.sql} COLLATE NOCASE`;
		if (nonNull.length) {
			params.push(...nonNull.map(dialect.toParam));
			parts.push(`${col} IN (${nonNull.map(() => '?').join(',')})`);
		}
		if (nonNull.length !== vals.length) parts.push(`${f.sql} IS NULL`);
		return parts.length ? '(' + parts.join(' OR ') + ')' : '0';
	},
	notEq(f, vals, params) {
		if (!vals.length) return '1=1';
		const col = f.kind === 'meta' ? f.sql : `${f.sql} COLLATE NOCASE`;
		return '(' + vals.map((v) => { params.push(dialect.toParam(v)); return `${col} IS NOT ?`; }).join(' AND ') + ')';
	},
	cmp(f, op, v, params) { params.push(dialect.toParam(v)); return `${f.sql} ${op} ?`; },
	between(f, a, b, params) { params.push(dialect.toParam(a), dialect.toParam(b)); return `${f.sql} BETWEEN ? AND ?`; },
	like(f, pattern, params) {
		params.push(pattern);
		return `${f.kind === 'meta' ? f.sql : `${f.sql} COLLATE NOCASE`} LIKE ? ESCAPE '\\'`;
	},
	isNull: (f, negate) => `${f.sql} IS ${negate ? 'NOT ' : ''}NULL`,
	order: (f, dir) => `${f.sql}${f.kind === 'doc' ? ' COLLATE NOCASE' : ''} ${dir}`
};

export async function connect(file) {
	const target = file || path.resolve(process.cwd(), 'data', 'vms.db');
	fs.mkdirSync(path.dirname(target), { recursive: true });
	const db = new DatabaseSync(target);
	db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
	const mutex = makeMutex();
	return {
		dialect,
		async all(sql, params = []) { return db.prepare(sql).all(...params.map(bind)); },
		async get(sql, params = []) { return db.prepare(sql).get(...params.map(bind)); },
		async run(sql, params = []) { const r = db.prepare(sql).run(...params.map(bind)); return { changes: Number(r.changes) }; },
		async exec(sql) { db.exec(sql); },
		lock: (key, fn) => mutex(key, fn),
		async close() { db.close(); }
	};
}
