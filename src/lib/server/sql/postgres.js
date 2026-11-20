// PostgreSQL driver. Two connection kinds:
//   postgres://user:pass@host:5432/db   -> `pg` connection pool (production)
//   pglite://./data/pg  or  pglite://memory -> embedded PostgreSQL (WASM) for tests / zero-install demos
import fs from 'node:fs';
import path from 'node:path';
import { makeMutex } from './mutex.js';

// text of a value as Postgres sees it when read with ->>
const asText = (v) =>
	typeof v === 'boolean' ? (v ? 'true' : 'false') : v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v);
const q = (attr) => `(data->>'${attr}')`;
const j = (attr) => `(data->'${attr}')`;

export const dialect = {
	name: 'postgres',
	types: { blob: 'BYTEA', big: 'BIGINT', seq: 'seq BIGSERIAL,' },
	jsonParam: '?::jsonb',
	rowOrder: 'seq',
	parseJson: (v) => (typeof v === 'string' ? JSON.parse(v) : v),
	toParam: (v) => v,
	field: (name) => ({ kind: 'doc', name, sql: q(name), json: j(name) }),
	eqIn(f, vals, params) {
		const nonNull = vals.filter((v) => v !== null && v !== undefined);
		const parts = [];
		if (nonNull.length) {
			if (f.kind === 'meta') {
				params.push(...nonNull.map(asText));
				parts.push(`${f.sql} IN (${nonNull.map(() => '?').join(',')})`);
			} else if (f.kind === 'column' && nonNull.every((v) => typeof v !== 'string')) {
				params.push(...nonNull);
				parts.push(`${f.sql} IN (${nonNull.map(() => '?').join(',')})`);
			} else {
				params.push(...nonNull.map(asText));
				parts.push(`lower(${f.sql}::text) IN (${nonNull.map(() => 'lower(?)').join(',')})`);
			}
		}
		if (nonNull.length !== vals.length) {
			parts.push(f.kind === 'doc' ? `(${f.json} IS NULL OR ${f.json} = 'null'::jsonb)` : `${f.sql} IS NULL`);
		}
		return parts.length ? '(' + parts.join(' OR ') + ')' : 'FALSE';
	},
	notEq(f, vals, params) {
		if (!vals.length) return 'TRUE';
		return '(' + vals.map((v) => {
			params.push(asText(v));
			return f.kind === 'meta' ? `${f.sql} IS DISTINCT FROM ?` : `lower(${f.sql}::text) IS DISTINCT FROM lower(?)`;
		}).join(' AND ') + ')';
	},
	cmp(f, op, v, params) {
		if (typeof v === 'number' && f.kind === 'doc') { params.push(JSON.stringify(v)); return `${f.json} ${op} ?::jsonb`; }
		params.push(typeof v === 'boolean' ? asText(v) : v);
		return `${f.sql} ${op} ?`;
	},
	between(f, a, b, params) {
		if (typeof a === 'number' && f.kind === 'doc') {
			params.push(JSON.stringify(a), JSON.stringify(b));
			return `${f.json} BETWEEN ?::jsonb AND ?::jsonb`;
		}
		params.push(a, b);
		return `${f.sql} BETWEEN ? AND ?`;
	},
	like(f, pattern, params) {
		params.push(pattern);
		return f.kind === 'meta' ? `${f.sql} LIKE ? ESCAPE '\\'` : `lower(${f.sql}::text) LIKE lower(?) ESCAPE '\\'`;
	},
	isNull: (f, negate) =>
		f.kind === 'doc'
			? negate
				? `(${f.json} IS NOT NULL AND ${f.json} <> 'null'::jsonb)`
				: `(${f.json} IS NULL OR ${f.json} = 'null'::jsonb)`
			: `${f.sql} IS ${negate ? 'NOT ' : ''}NULL`,
	order: (f, dir) =>
		f.kind === 'doc'
			? `CASE WHEN jsonb_typeof(${f.json}) = 'number' THEN (${f.sql})::numeric END ${dir}, lower(${f.sql}) ${dir}`
			: `${f.sql} ${dir}`
};

// "?" placeholders -> "$1, $2, ..."
const toPg = (sql) => {
	let i = 0;
	return sql.replace(/\?/g, () => '$' + ++i);
};
const bind = (v) => (v === undefined ? null : v);

export async function connect(url) {
	if (url.startsWith('pglite://')) {
		// optional dev/test dependency: loaded by name at run time so the bundler leaves it alone
		const pgliteModule = '@electric-sql/pglite';
		const { PGlite } = await import(/* @vite-ignore */ pgliteModule);
		const loc = url.slice('pglite://'.length);
		const inMemory = loc === 'memory' || !loc;
		if (!inMemory) fs.mkdirSync(path.dirname(path.resolve(loc)), { recursive: true });
		const pg = new PGlite(inMemory ? undefined : loc);
		await pg.waitReady;
		const mutex = makeMutex();
		const run = (sql, params) => pg.query(toPg(sql), params.map(bind));
		return {
			dialect,
			async all(sql, params = []) { return (await run(sql, params)).rows; },
			async get(sql, params = []) { return (await run(sql, params)).rows[0]; },
			async run(sql, params = []) { const r = await run(sql, params); return { changes: r.affectedRows ?? 0 }; },
			async exec(sql) { await pg.exec(sql); },
			lock: (key, fn) => mutex(key, fn),
			async close() { await pg.close(); }
		};
	}

	const { default: pg } = await import('pg');
	pg.types.setTypeParser(20, (v) => Number(v)); // BIGINT -> number (counters/epoch ms fit)
	const pool = new pg.Pool({
		connectionString: url,
		max: Number(process.env.DB_POOL_MAX) || 10,
		ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' } : undefined
	});
	return {
		dialect,
		async all(sql, params = []) { return (await pool.query(toPg(sql), params.map(bind))).rows; },
		async get(sql, params = []) { return (await pool.query(toPg(sql), params.map(bind))).rows[0]; },
		async run(sql, params = []) { return { changes: (await pool.query(toPg(sql), params.map(bind))).rowCount ?? 0 }; },
		async exec(sql) { await pool.query(sql); },
		// cross-instance lock: a dedicated connection holds a Postgres advisory lock for the key
		async lock(key, fn) {
			const c = await pool.connect();
			try {
				await c.query('SELECT pg_advisory_lock(hashtext($1))', [key]);
				return await fn();
			} finally {
				try { await c.query('SELECT pg_advisory_unlock(hashtext($1))', [key]); } finally { c.release(); }
			}
		},
		async close() { await pool.end(); }
	};
}
