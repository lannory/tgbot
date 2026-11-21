import { pool } from './db.js';

export const STATS_TIMEZONE = process.env.STATS_TIMEZONE || 'Europe/Kyiv';

const LANGS = ['uk', 'en'];

function clip(value, max) {
	return typeof value === 'string' && value.length > 0 ? value.slice(0, max) : null;
}

// Makes sure a chat has a bot_users row (e.g. a search created via the API
// before the bot reported the user). Never overwrites existing data.
export async function ensureUser(chatId) {
	await pool.query('INSERT INTO bot_users (chat_id) VALUES ($1) ON CONFLICT (chat_id) DO NOTHING', [chatId]);
}

// Records an interaction: first visit sets created_at, every visit refreshes
// profile fields and last_seen_at, marks today as active and clears the
// "blocked the bot" flag (the user evidently talks to the bot again).
export async function touchUser(chatId, { username, firstName, languageCode, lang } = {}) {
	const { rows } = await pool.query(
		`WITH upsert AS (
			INSERT INTO bot_users (chat_id, username, first_name, language_code, lang, last_seen_at)
			VALUES ($1, $2, $3, $4, $5, now())
			ON CONFLICT (chat_id) DO UPDATE SET
				username = EXCLUDED.username,
				first_name = COALESCE(EXCLUDED.first_name, bot_users.first_name),
				language_code = COALESCE(EXCLUDED.language_code, bot_users.language_code),
				lang = COALESCE(EXCLUDED.lang, bot_users.lang),
				last_seen_at = now(),
				bot_blocked_at = NULL
			RETURNING admin_blocked_at
		), activity AS (
			INSERT INTO user_activity_daily (chat_id, day)
			VALUES ($1, (now() AT TIME ZONE $6)::date)
			ON CONFLICT DO NOTHING
		)
		SELECT admin_blocked_at FROM upsert`,
		[
			chatId,
			clip(username, 64),
			clip(firstName, 128),
			clip(languageCode, 16),
			LANGS.includes(lang) ? lang : null,
			STATS_TIMEZONE,
		]
	);
	return { blocked: rows[0]?.admin_blocked_at != null };
}

export async function setBotBlocked(chatId, blocked) {
	await pool.query(
		`INSERT INTO bot_users (chat_id, bot_blocked_at) VALUES ($1, CASE WHEN $2 THEN now() END)
		 ON CONFLICT (chat_id) DO UPDATE SET
			bot_blocked_at = CASE WHEN $2 THEN COALESCE(bot_users.bot_blocked_at, now()) ELSE NULL END`,
		[chatId, blocked]
	);
}

export async function isAdminBlocked(chatId) {
	const { rows } = await pool.query('SELECT admin_blocked_at FROM bot_users WHERE chat_id = $1', [chatId]);
	return rows[0]?.admin_blocked_at != null;
}

export async function logUserError(chatId, kind, message) {
	await pool.query(
		'INSERT INTO user_errors (chat_id, kind, message) VALUES ($1, $2, $3)',
		[chatId, kind, clip(message, 1000)]
	);
}

// Applies delivery results reported by the bot
export async function recordDeliveryResults(results) {
	const blockedChats = new Set();

	for (const r of results) {
		if (r.logId != null) {
			await pool.query(
				`UPDATE notification_log
				 SET status = $2, error = $3, sent_at = CASE WHEN $2 = 'sent' THEN now() ELSE sent_at END
				 WHERE id = $1 AND chat_id = $4`,
				[r.logId, r.ok ? 'sent' : 'failed', r.ok ? null : clip(r.error, 1000), r.chatId]
			);
		}
		if (!r.ok && !r.skipped) {
			await logUserError(r.chatId, r.blocked ? 'bot_blocked' : 'delivery_failed', r.error);
		}
		if (r.blocked) blockedChats.add(r.chatId);
	}

	for (const chatId of blockedChats) {
		await setBotBlocked(chatId, true);
	}
}

// Housekeeping: drop history older than the retention window
export async function purgeOldHistory(retentionDays) {
	await pool.query(`DELETE FROM notification_log WHERE created_at < now() - make_interval(days => $1)`, [retentionDays]);
	await pool.query(`DELETE FROM user_errors WHERE created_at < now() - make_interval(days => $1)`, [retentionDays]);
}
