// Table definitions shared by the app and scripts/migrate-db.mjs (pure: no framework imports).
export function schemaStatements(D) {
	const { blob, big, seq } = D.types;
	return [
		`CREATE TABLE IF NOT EXISTS users (
			id TEXT PRIMARY KEY,
			email TEXT NOT NULL UNIQUE,
			name TEXT NOT NULL DEFAULT '',
			phone TEXT NOT NULL DEFAULT '',
			password_hash TEXT NOT NULL,
			labels TEXT NOT NULL DEFAULT '[]',
			status INTEGER NOT NULL DEFAULT 1,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS auth_sessions (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			token_hash TEXT NOT NULL UNIQUE,
			ip TEXT NOT NULL DEFAULT '',
			client_name TEXT NOT NULL DEFAULT '',
			os_name TEXT NOT NULL DEFAULT '',
			device_name TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL,
			expires_at TEXT NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id)`,
		`CREATE TABLE IF NOT EXISTS team_memberships (
			id TEXT PRIMARY KEY,
			team_id TEXT NOT NULL,
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			email TEXT NOT NULL DEFAULT '',
			roles TEXT NOT NULL DEFAULT '[]',
			created_at TEXT NOT NULL,
			UNIQUE(team_id, user_id)
		)`,
		`CREATE TABLE IF NOT EXISTS recovery_tokens (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			token_hash TEXT NOT NULL,
			expires_at TEXT NOT NULL,
			used INTEGER NOT NULL DEFAULT 0
		)`,
		`CREATE TABLE IF NOT EXISTS visitor_sessions (
			token_hash TEXT PRIMARY KEY,
			phone TEXT NOT NULL,
			expires_at TEXT NOT NULL,
			created_at TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
		`CREATE TABLE IF NOT EXISTS rate_limits (
			key TEXT PRIMARY KEY,
			hits INTEGER NOT NULL,
			reset_at ${big} NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS audit_log (
			${seq}
			id TEXT PRIMARY KEY,
			at TEXT NOT NULL,
			actor TEXT NOT NULL DEFAULT '',
			action TEXT NOT NULL,
			target TEXT NOT NULL DEFAULT '',
			ip TEXT NOT NULL DEFAULT '',
			detail TEXT NOT NULL DEFAULT ''
		)`,
		`CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at)`,
		`CREATE TABLE IF NOT EXISTS files (
			bucket TEXT NOT NULL,
			id TEXT NOT NULL,
			name TEXT NOT NULL DEFAULT '',
			mime TEXT NOT NULL DEFAULT 'application/octet-stream',
			size INTEGER NOT NULL DEFAULT 0,
			data ${blob} NOT NULL,
			created_at TEXT NOT NULL,
			PRIMARY KEY (bucket, id)
		)`
	];
}

/** DDL of one document collection table */
export function collectionTableDDL(D, table) {
	return `CREATE TABLE IF NOT EXISTS "${table}" (
		${D.types.seq}
		id TEXT PRIMARY KEY,
		data ${D.name === 'postgres' ? 'JSONB' : 'TEXT'} NOT NULL DEFAULT '{}',
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	)`;
}
