import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const { pool, init } = await import('../db.js');
const { runMigrations } = await import('../lib/migrate.js');

try {
	await init();
	const applied = await runMigrations(pool);
	console.log(applied.length ? `Applied ${applied.length} migration(s).` : 'Database is up to date.');
} catch (err) {
	console.error(err.message);
	process.exitCode = 1;
} finally {
	await pool.end();
}
