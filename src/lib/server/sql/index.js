// Chooses the database engine from the environment.
//   DATABASE_URL=postgres://...   PostgreSQL (recommended for production)
//   DATABASE_URL=pglite://...     embedded PostgreSQL (tests, zero-install demos)
//   DB_PATH=./data/vms.db         SQLite file (default, zero setup)
export async function connectDriver(env) {
	const url = env.DATABASE_URL;
	if (url && /^(postgres(ql)?|pglite):\/\//.test(url)) {
		return (await import('./postgres.js')).connect(url.replace(/^postgresql:/, 'postgres:'));
	}
	return (await import('./sqlite.js')).connect(env.DB_PATH);
}
