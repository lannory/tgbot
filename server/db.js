import pg from 'pg';
import { runMigrations } from './lib/migrate.js';

const { Pool } = pg;

export const pool = new Pool({
	connectionString: process.env.DATABASE_URL,
});

export async function init() {
	await pool.query(`
		CREATE TABLE IF NOT EXISTS searches (
			id SERIAL PRIMARY KEY,
			chat_id TEXT NOT NULL,
			query TEXT NOT NULL,
			source TEXT NOT NULL DEFAULT 'ebay',
			category_id TEXT,
			min_price NUMERIC,
			max_price NUMERIC,
			condition TEXT,
			buying_option TEXT,
			us_only BOOLEAN NOT NULL DEFAULT false,
			active BOOLEAN NOT NULL DEFAULT true,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			last_item_created_at TIMESTAMPTZ NOT NULL DEFAULT now()
		);

		ALTER TABLE searches ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'ebay';
		ALTER TABLE searches ADD COLUMN IF NOT EXISTS category_id TEXT;
		ALTER TABLE searches ADD COLUMN IF NOT EXISTS min_price NUMERIC;
		ALTER TABLE searches ADD COLUMN IF NOT EXISTS max_price NUMERIC;
		ALTER TABLE searches ADD COLUMN IF NOT EXISTS condition TEXT;
		ALTER TABLE searches ADD COLUMN IF NOT EXISTS buying_option TEXT;
		ALTER TABLE searches ADD COLUMN IF NOT EXISTS us_only BOOLEAN NOT NULL DEFAULT false;
		ALTER TABLE searches ADD COLUMN IF NOT EXISTS last_item_created_at TIMESTAMPTZ NOT NULL DEFAULT now();

		CREATE TABLE IF NOT EXISTS seen_items (
			search_id INTEGER NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
			item_id TEXT NOT NULL,
			PRIMARY KEY (search_id, item_id)
		);

		CREATE TABLE IF NOT EXISTS notifications (
			id SERIAL PRIMARY KEY,
			chat_id TEXT NOT NULL,
			search_id INTEGER REFERENCES searches(id) ON DELETE CASCADE,
			payload JSONB NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now()
		);

		ALTER TABLE notifications ALTER COLUMN search_id DROP NOT NULL;

		CREATE TABLE IF NOT EXISTS ebay_tokens (
			chat_id TEXT PRIMARY KEY,
			refresh_token TEXT NOT NULL,
			access_token TEXT,
			access_expires_at TIMESTAMPTZ,
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
		);

		CREATE TABLE IF NOT EXISTS snipes (
			id SERIAL PRIMARY KEY,
			chat_id TEXT NOT NULL,
			item_id TEXT NOT NULL,
			legacy_item_id TEXT NOT NULL,
			title TEXT,
			end_time TIMESTAMPTZ NOT NULL,
			max_bid NUMERIC NOT NULL,
			currency TEXT NOT NULL DEFAULT 'USD',
			status TEXT NOT NULL DEFAULT 'pending',
			error TEXT,
			placed_at TIMESTAMPTZ,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now()
		);
	`);
}

// Base tables (init) plus the additive SQL migrations in ./migrations
export async function ensureSchema() {
	await init();
	await runMigrations(pool);
}

export async function countSearchesByChat(chatId) {
	const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM searches WHERE chat_id = $1', [chatId]);
	return rows[0].count;
}

export async function createSearch(chatId, filters) {
	const {
		query,
		source = 'ebay',
		categoryId = null,
		minPrice = null,
		maxPrice = null,
		condition = null,
		buyingOption = null,
		usOnly = false,
	} = filters;

	const { rows } = await pool.query(
		`INSERT INTO searches (chat_id, query, source, category_id, min_price, max_price, condition, buying_option, us_only)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
		[chatId, query, source, categoryId, minPrice, maxPrice, condition, buyingOption, usOnly]
	);
	return rows[0];
}

export async function listActiveSearches() {
	const { rows } = await pool.query('SELECT * FROM searches WHERE active = true');
	return rows;
}

// Active searches of users who can still receive notifications: not blocked
// by an admin and not having blocked the bot themselves
export async function listPollableSearches() {
	const { rows } = await pool.query(
		`SELECT s.* FROM searches s
		 LEFT JOIN bot_users u ON u.chat_id = s.chat_id
		 WHERE s.active = true AND u.admin_blocked_at IS NULL AND u.bot_blocked_at IS NULL`
	);
	return rows;
}

export async function listSearchesByChat(chatId) {
	const { rows } = await pool.query(
		'SELECT * FROM searches WHERE chat_id = $1 ORDER BY created_at ASC',
		[chatId]
	);
	return rows;
}

export async function setActive(id, chatId, active) {
	const { rows } = await pool.query(
		'UPDATE searches SET active = $1 WHERE id = $2 AND chat_id = $3 RETURNING *',
		[active, id, chatId]
	);
	return rows[0] ?? null;
}

export async function deleteSearch(id, chatId) {
	const { rows } = await pool.query(
		'DELETE FROM searches WHERE id = $1 AND chat_id = $2 RETURNING *',
		[id, chatId]
	);
	return rows[0] ?? null;
}

export async function hasSeen(searchId, itemId) {
	const { rows } = await pool.query(
		'SELECT 1 FROM seen_items WHERE search_id = $1 AND item_id = $2',
		[searchId, itemId]
	);
	return rows.length > 0;
}

export async function markSeen(searchId, itemId) {
	await pool.query(
		'INSERT INTO seen_items (search_id, item_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
		[searchId, itemId]
	);
}

export async function advanceLastItemCreatedAt(searchId, timestamp) {
	await pool.query(
		'UPDATE searches SET last_item_created_at = GREATEST(last_item_created_at, $2) WHERE id = $1',
		[searchId, timestamp]
	);
}

// Queues a notification for the bot and records it in notification_log
// (the queue row is deleted on delivery, the log row is kept as history)
export async function enqueueNotification(chatId, searchId, payload) {
	const kind = payload.type === 'snipe_update' ? 'snipe' : 'listing';
	const platform = payload.source ?? 'ebay';
	const title = typeof payload.title === 'string' ? payload.title.slice(0, 300) : null;
	const url = typeof payload.itemWebUrl === 'string' ? payload.itemWebUrl.slice(0, 1000) : null;

	await pool.query(
		`WITH log AS (
			INSERT INTO notification_log (chat_id, search_id, platform, kind, title, url)
			VALUES ($1, $2, $4, $5, $6, $7) RETURNING id
		), touched AS (
			UPDATE searches SET last_notified_at = now() WHERE id = $2
		)
		INSERT INTO notifications (chat_id, search_id, payload, log_id)
		SELECT $1, $2, $3, id FROM log`,
		[chatId, searchId, JSON.stringify(payload), platform, kind, title, url]
	);
}

export async function saveEbayToken(chatId, { refreshToken, accessToken, accessExpiresAt }) {
	await pool.query(
		`INSERT INTO ebay_tokens (chat_id, refresh_token, access_token, access_expires_at, updated_at)
		 VALUES ($1, $2, $3, $4, now())
		 ON CONFLICT (chat_id) DO UPDATE SET
			refresh_token = EXCLUDED.refresh_token,
			access_token = EXCLUDED.access_token,
			access_expires_at = EXCLUDED.access_expires_at,
			updated_at = now()`,
		[chatId, refreshToken, accessToken, accessExpiresAt]
	);
}

export async function updateEbayAccessToken(chatId, accessToken, accessExpiresAt) {
	await pool.query(
		'UPDATE ebay_tokens SET access_token = $2, access_expires_at = $3, updated_at = now() WHERE chat_id = $1',
		[chatId, accessToken, accessExpiresAt]
	);
}

export async function getEbayToken(chatId) {
	const { rows } = await pool.query('SELECT * FROM ebay_tokens WHERE chat_id = $1', [chatId]);
	return rows[0] ?? null;
}

export async function createSnipe(chatId, { itemId, legacyItemId, title, endTime, maxBid, currency }) {
	const { rows } = await pool.query(
		`INSERT INTO snipes (chat_id, item_id, legacy_item_id, title, end_time, max_bid, currency)
		 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
		[chatId, itemId, legacyItemId, title, endTime, maxBid, currency]
	);
	return rows[0];
}

export async function listSnipesByChat(chatId) {
	const { rows } = await pool.query(
		'SELECT * FROM snipes WHERE chat_id = $1 ORDER BY end_time ASC',
		[chatId]
	);
	return rows;
}

export async function cancelSnipe(id, chatId) {
	const { rows } = await pool.query(
		`UPDATE snipes SET status = 'cancelled' WHERE id = $1 AND chat_id = $2 AND status = 'pending' RETURNING *`,
		[id, chatId]
	);
	return rows[0] ?? null;
}

export async function listDueSnipes(leadSeconds) {
	const { rows } = await pool.query(
		`SELECT * FROM snipes
		 WHERE status = 'pending' AND end_time - make_interval(secs => $1) <= now() AND end_time > now()`,
		[leadSeconds]
	);
	return rows;
}

export async function listMissedSnipes() {
	const { rows } = await pool.query(
		`SELECT * FROM snipes WHERE status = 'pending' AND end_time <= now()`
	);
	return rows;
}

export async function listPlacedAwaitingResult() {
	const { rows } = await pool.query(
		`SELECT * FROM snipes WHERE status = 'placed' AND end_time + interval '60 seconds' <= now()`
	);
	return rows;
}

export async function updateSnipeStatus(id, status, { error = null, placedAt = null } = {}) {
	const { rows } = await pool.query(
		`UPDATE snipes SET status = $2, error = $3, placed_at = COALESCE($4, placed_at) WHERE id = $1 RETURNING *`,
		[id, status, error, placedAt]
	);
	return rows[0] ?? null;
}

export async function popAllNotifications() {
	// DELETE ... RETURNING does not guarantee row order, so re-sort by id
	// to deliver notifications in the order they were enqueued
	const { rows } = await pool.query(
		'WITH deleted AS (DELETE FROM notifications RETURNING id, chat_id, payload, log_id) SELECT * FROM deleted ORDER BY id'
	);

	const byChat = new Map();
	for (const row of rows) {
		if (!byChat.has(row.chat_id)) byChat.set(row.chat_id, []);
		// _logId lets the bot report the delivery result back (POST /notifications/report)
		byChat.get(row.chat_id).push(row.log_id != null ? { ...row.payload, _logId: row.log_id } : row.payload);
	}

	return [...byChat.entries()].map(([chatId, items]) => ({ chatId, items }));
}
