import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
	connectionString: process.env.DATABASE_URL,
});

export async function init() {
	await pool.query(`
		CREATE TABLE IF NOT EXISTS searches (
			id SERIAL PRIMARY KEY,
			chat_id TEXT NOT NULL,
			query TEXT NOT NULL,
			category_id TEXT,
			min_price NUMERIC,
			max_price NUMERIC,
			condition TEXT,
			buying_option TEXT,
			us_only BOOLEAN NOT NULL DEFAULT false,
			active BOOLEAN NOT NULL DEFAULT true,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now()
		);

		ALTER TABLE searches ADD COLUMN IF NOT EXISTS category_id TEXT;
		ALTER TABLE searches ADD COLUMN IF NOT EXISTS min_price NUMERIC;
		ALTER TABLE searches ADD COLUMN IF NOT EXISTS max_price NUMERIC;
		ALTER TABLE searches ADD COLUMN IF NOT EXISTS condition TEXT;
		ALTER TABLE searches ADD COLUMN IF NOT EXISTS buying_option TEXT;
		ALTER TABLE searches ADD COLUMN IF NOT EXISTS us_only BOOLEAN NOT NULL DEFAULT false;

		CREATE TABLE IF NOT EXISTS seen_items (
			search_id INTEGER NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
			item_id TEXT NOT NULL,
			PRIMARY KEY (search_id, item_id)
		);

		CREATE TABLE IF NOT EXISTS notifications (
			id SERIAL PRIMARY KEY,
			chat_id TEXT NOT NULL,
			search_id INTEGER NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
			payload JSONB NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now()
		);
	`);
}

export async function countSearchesByChat(chatId) {
	const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM searches WHERE chat_id = $1', [chatId]);
	return rows[0].count;
}

export async function createSearch(chatId, filters) {
	const {
		query,
		categoryId = null,
		minPrice = null,
		maxPrice = null,
		condition = null,
		buyingOption = null,
		usOnly = false,
	} = filters;

	const { rows } = await pool.query(
		`INSERT INTO searches (chat_id, query, category_id, min_price, max_price, condition, buying_option, us_only)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
		[chatId, query, categoryId, minPrice, maxPrice, condition, buyingOption, usOnly]
	);
	return rows[0];
}

export async function listActiveSearches() {
	const { rows } = await pool.query('SELECT * FROM searches WHERE active = true');
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

export async function enqueueNotification(chatId, searchId, payload) {
	await pool.query(
		'INSERT INTO notifications (chat_id, search_id, payload) VALUES ($1, $2, $3)',
		[chatId, searchId, JSON.stringify(payload)]
	);
}

export async function popAllNotifications() {
	const { rows } = await pool.query('DELETE FROM notifications RETURNING chat_id, payload');

	const byChat = new Map();
	for (const row of rows) {
		if (!byChat.has(row.chat_id)) byChat.set(row.chat_id, []);
		byChat.get(row.chat_id).push(row.payload);
	}

	return [...byChat.entries()].map(([chatId, items]) => ({ chatId, items }));
}
