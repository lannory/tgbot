import { pool } from './db.js';
import { purgeOldHistory } from './users.js';
import { expireSubscriptions } from './billing/subscriptions.js';

const INTERVAL_MS = 60 * 60_000;
const RETENTION_DAYS = Number(process.env.HISTORY_RETENTION_DAYS) || 90;

async function runMaintenance() {
	try {
		const expired = await expireSubscriptions(pool);
		if (expired > 0) console.log(`[maintenance] ${expired} subscription(s) expired`);
		await purgeOldHistory(RETENTION_DAYS);
	} catch (err) {
		console.log('[maintenance] failed', err.message);
	}
}

export function startMaintenance() {
	runMaintenance();
	setInterval(runMaintenance, INTERVAL_MS);
}
