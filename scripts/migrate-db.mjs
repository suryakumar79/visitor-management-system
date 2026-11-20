#!/usr/bin/env node
// Copy all data from one database to another (typically SQLite -> PostgreSQL).
//
//   node scripts/migrate-db.mjs <source> <target>
//
//   source / target:   sqlite:./data/vms.db
//                      postgres://user:password@host:5432/vms
//
// Example:   node scripts/migrate-db.mjs sqlite:./data/vms.db postgres://vms:secret@localhost:5432/vms
//
// Stop the app first. The target is created if empty; rows that already exist there are left untouched
// (safe to re-run). Sessions, rate limits and one-time tokens are not copied: everyone signs in again.
import { connect as connectSqlite } from '../src/lib/server/sql/sqlite.js';
import { connect as connectPostgres } from '../src/lib/server/sql/postgres.js';
import { schemaStatements, collectionTableDDL } from '../src/lib/server/sql/schema.js';

const [src, dst] = process.argv.slice(2);
if (!src || !dst) {
	console.error('Usage: node scripts/migrate-db.mjs <source> <target>   e.g. sqlite:./data/vms.db postgres://user:pass@host/db');
	process.exit(2);
}

const open = (spec) =>
	spec.startsWith('sqlite:') ? connectSqlite(spec.slice('sqlite:'.length)) :
	/^(postgres(ql)?|pglite):\/\//.test(spec) ? connectPostgres(spec.replace(/^postgresql:/, 'postgres:')) :
	Promise.reject(new Error(`Unknown database "${spec}"`));

const from = await open(src);
const to = await open(dst);

// the ordered list of fixed tables and the columns to copy (parents before children)
const FIXED = [
	['users', ['id', 'email', 'name', 'phone', 'password_hash', 'labels', 'status', 'created_at', 'updated_at']],
	['team_memberships', ['id', 'team_id', 'user_id', 'email', 'roles', 'created_at']],
	['kv', ['key', 'value']],
	['audit_log', ['id', 'at', 'actor', 'action', 'target', 'ip', 'detail']],
	['files', ['bucket', 'id', 'name', 'mime', 'size', 'data', 'created_at']]
];

async function listCollectionTables() {
	if (from.dialect.name === 'sqlite') {
		return (await from.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'col\\_%' ESCAPE '\\'")).map((r) => r.name);
	}
	return (await from.all("SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name LIKE 'col\\_%'")).map((r) => r.name);
}

async function copy(table, cols, { json = false } = {}) {
	const rows = await from.all(`SELECT ${cols.join(', ')} FROM "${table}"`);
	const placeholders = cols.map((c) => (json && c === 'data' ? to.dialect.jsonParam : '?')).join(', ');
	let n = 0;
	for (const r of rows) {
		const values = cols.map((c) => {
			let v = r[c];
			if (json && c === 'data') v = typeof v === 'string' ? v : JSON.stringify(v);
			if (c === 'data' && !json && v) v = Buffer.from(v);
			return v;
		});
		const res = await to.run(`INSERT INTO "${table}" (${cols.join(', ')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`, values);
		n += res.changes ? 1 : 0;
	}
	console.log(`  ${table.padEnd(28)} ${String(rows.length).padStart(6)} read, ${String(n).padStart(6)} written`);
}

try {
	console.log(`Source: ${from.dialect.name}   Target: ${to.dialect.name}`);
	for (const stmt of schemaStatements(to.dialect)) await to.exec(stmt);
	for (const [table, cols] of FIXED) await copy(table, cols);
	for (const table of await listCollectionTables()) {
		await to.exec(collectionTableDDL(to.dialect, table));
		await copy(table, ['id', 'data', 'created_at', 'updated_at'], { json: true });
	}
	console.log('\nDone. Start the app with DATABASE_URL pointing at the target.');
} catch (e) {
	console.error('\nMigration failed:', e.message);
	process.exitCode = 1;
} finally {
	await from.close();
	await to.close();
}
