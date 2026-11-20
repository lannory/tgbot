import { pool } from './db.js';
import { purgeOldHistory } from './users.js';

const INTERVAL_MS = 60 * 60_000;
const RETENTION_DAYS = Number(process.env.HISTORY_RETENTION_DAYS) || 90;

async function runMaintenance() {
	try {
		await purgeOldHistory(RETENTION_DAYS);
	} catch (err) {
		console.log('[maintenance] failed', err.message);
	}
}

export function startMaintenance() {
	runMaintenance();
	setInterval(runMaintenance, INTERVAL_MS);
}
