import { pool } from '../db.js';

// The single place where the bot decides what a user may do.
// While PAYMENTS_ENABLED is not "true", every answer reproduces the bot's
// behaviour before plans existed (MAX_SEARCHES_PER_CHAT, POLL_INTERVAL_MS).

export const SOURCES = ['ebay', 'olx'];

export function paymentsEnabled() {
	return process.env.PAYMENTS_ENABLED === 'true';
}

export function legacyMaxSearches() {
	return Number(process.env.MAX_SEARCHES_PER_CHAT) || 5;
}

export function baseCheckIntervalMs() {
	return Number(process.env.POLL_INTERVAL_MS) || 90_000;
}

// The plan that applies to the chat right now: the current subscription's
// plan, or the default (free) plan for everyone without one
export async function getUserPlan(chatId, db = pool) {
	const { rows } = await db.query(
		`SELECT p.*, cs.id AS subscription_id, cs.status AS subscription_status, cs.ends_at AS subscription_ends_at
		 FROM plans p
		 LEFT JOIN current_subscriptions cs ON cs.plan_id = p.id AND cs.chat_id = $1
		 WHERE cs.id IS NOT NULL OR p.is_default
		 ORDER BY (cs.id IS NOT NULL) DESC
		 LIMIT 1`,
		[chatId]
	);
	return rows[0] ?? null;
}

// { ok: true } or { ok: false, code, error } with a user-facing message
export async function canCreateSearch(chatId, source, db = pool) {
	const { rows } = await db.query('SELECT COUNT(*)::int AS count FROM searches WHERE chat_id = $1', [chatId]);
	const count = rows[0].count;

	if (!paymentsEnabled()) {
		const max = legacyMaxSearches();
		if (count >= max) return { ok: false, code: 'search_limit', error: `Max ${max} searches per chat` };
		return { ok: true };
	}

	const plan = await getUserPlan(chatId, db);
	if (!plan) return { ok: true };

	if (!plan.platforms.includes(source)) {
		return { ok: false, code: 'platform_not_in_plan', error: `Your plan (${plan.name}) does not include ${source}` };
	}
	if (plan.max_searches != null && count >= plan.max_searches) {
		return { ok: false, code: 'search_limit', error: `Max ${plan.max_searches} searches on your plan (${plan.name})` };
	}
	return { ok: true };
}

export async function canUsePlatform(chatId, source, db = pool) {
	if (!paymentsEnabled()) return SOURCES.includes(source);
	const plan = await getUserPlan(chatId, db);
	return plan ? plan.platforms.includes(source) : true;
}

export async function getCheckInterval(chatId, db = pool) {
	const map = await getCheckIntervals([chatId], db);
	return map.get(chatId);
}

// Poll interval (ms) per chat, in one query for the whole poll cycle
export async function getCheckIntervals(chatIds, db = pool) {
	const base = baseCheckIntervalMs();
	const result = new Map(chatIds.map((id) => [id, base]));
	if (!paymentsEnabled() || chatIds.length === 0) return result;

	const { rows } = await db.query(
		`SELECT ids.chat_id, COALESCE(p.check_interval_sec, dp.check_interval_sec) AS sec
		 FROM unnest($1::text[]) AS ids(chat_id)
		 LEFT JOIN current_subscriptions cs ON cs.chat_id = ids.chat_id
		 LEFT JOIN plans p ON p.id = cs.plan_id
		 LEFT JOIN plans dp ON dp.is_default`,
		[chatIds]
	);
	for (const row of rows) {
		if (row.sec != null) result.set(row.chat_id, row.sec * 1000);
	}
	return result;
}
