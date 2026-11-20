// Test harness: every test file gets its own throwaway Postgres schema in
// TEST_DATABASE_URL, so tests never touch the real tables in `public`.
// db.js creates its pool at import time, hence env is set up before any
// project module is imported (always import project code via setupTestDb).
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import pg from 'pg';

// Only TEST_DATABASE_URL is taken from server/.env; nothing else from the
// real config leaks into tests
const envFile = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env');
if (!process.env.TEST_DATABASE_URL && fs.existsSync(envFile)) {
	const parsed = dotenv.parse(fs.readFileSync(envFile));
	if (parsed.TEST_DATABASE_URL) process.env.TEST_DATABASE_URL = parsed.TEST_DATABASE_URL;
}

export const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);
export const skipReason = hasTestDb ? false : 'TEST_DATABASE_URL is not set';

export async function setupTestDb(env = {}) {
	const schema = `test_${process.pid}_${crypto.randomBytes(4).toString('hex')}`;
	const url = new URL(process.env.TEST_DATABASE_URL);
	url.searchParams.set('options', `-c search_path=${schema}`);

	const admin = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
	await admin.connect();
	await admin.query(`CREATE SCHEMA ${schema}`);
	await admin.end();

	process.env.DATABASE_URL = url.toString();
	Object.assign(process.env, env);

	const db = await import('../db.js');
	await db.ensureSchema();

	return {
		schema,
		pool: db.pool,
		db,
		async cleanup() {
			await db.pool.end();
			const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
			await c.connect();
			await c.query(`DROP SCHEMA ${schema} CASCADE`);
			await c.end();
		},
	};
}
