import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

// Arbitrary constant: serializes migration runs between the bot API server,
// the admin panel and `npm run migrate` if they start at the same time
const LOCK_KEY = 482_910_337;

export function listMigrationFiles() {
	return fs.readdirSync(MIGRATIONS_DIR)
		.filter((f) => /^\d+_.+\.sql$/.test(f))
		.sort();
}

// Applies pending SQL migrations in order, each in its own transaction.
// Migrations are expected to be additive; already applied ones are skipped.
export async function runMigrations(pool, { log = console.log } = {}) {
	const client = await pool.connect();
	try {
		await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);

		await client.query(`
			CREATE TABLE IF NOT EXISTS schema_migrations (
				name TEXT PRIMARY KEY,
				applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
			)
		`);

		const { rows } = await client.query('SELECT name FROM schema_migrations');
		const applied = new Set(rows.map((r) => r.name));
		const pending = listMigrationFiles().filter((f) => !applied.has(f));

		for (const file of pending) {
			const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
			try {
				await client.query('BEGIN');
				await client.query(sql);
				await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
				await client.query('COMMIT');
				log(`[migrate] applied ${file}`);
			} catch (err) {
				await client.query('ROLLBACK');
				throw new Error(`migration ${file} failed: ${err.message}`);
			}
		}

		return pending;
	} finally {
		await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
		client.release();
	}
}
