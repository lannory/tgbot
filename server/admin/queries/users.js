export const USER_STATUSES = ['active', 'bot_blocked', 'admin_blocked'];
export const PLATFORM_FILTERS = ['olx', 'ebay', 'none'];
export const PAGE_SIZES = [25, 50, 100];

// Whitelisted sort keys -> SQL expressions over the `base` CTE below
const SORTS = {
	chat_id: `CASE WHEN chat_id ~ '^-?[0-9]+$' THEN chat_id::numeric END`,
	username: 'lower(username)',
	first_name: 'lower(first_name)',
	lang: 'lang',
	created_at: 'created_at',
	last_seen_at: 'last_seen_at',
	olx: 'olx_active',
	ebay: 'ebay_active',
	status: 'status',
	plan: 'plan_code',
};
export const SORT_KEYS = Object.keys(SORTS);

const STATUS_SQL = `CASE
	WHEN u.admin_blocked_at IS NOT NULL THEN 'admin_blocked'
	WHEN u.bot_blocked_at IS NOT NULL THEN 'bot_blocked'
	ELSE 'active' END`;

const BASE_CTE = `
	search_counts AS (
		SELECT chat_id,
			count(*) FILTER (WHERE active AND source = 'olx')::int AS olx_active,
			count(*) FILTER (WHERE active AND source = 'ebay')::int AS ebay_active
		FROM searches GROUP BY chat_id
	),
	base AS (
		SELECT u.chat_id, u.username, u.first_name, u.lang, u.language_code,
			u.created_at, u.last_seen_at, u.bot_blocked_at, u.admin_blocked_at, u.admin_block_reason,
			COALESCE(sc.olx_active, 0) AS olx_active,
			COALESCE(sc.ebay_active, 0) AS ebay_active,
			${STATUS_SQL} AS status,
			COALESCE(p.code, dp.code) AS plan_code,
			COALESCE(p.name, dp.name) AS plan_name
		FROM bot_users u
		LEFT JOIN search_counts sc ON sc.chat_id = u.chat_id
		LEFT JOIN current_subscriptions cs ON cs.chat_id = u.chat_id
		LEFT JOIN plans p ON p.id = cs.plan_id
		LEFT JOIN plans dp ON dp.is_default
	)`;

function escapeLike(text) {
	return text.replace(/[\\%_]/g, (c) => '\\' + c);
}

// filters: { q, status, platform, plan, regFrom, regTo, sort, dir, page, pageSize } — already validated
export async function listUsers(db, filters, tz) {
	const where = [];
	const params = [];
	const param = (v) => {
		params.push(v);
		return `$${params.length}`;
	};

	if (filters.q) {
		const q = filters.q.replace(/^@/, '');
		const like = param(`%${escapeLike(q)}%`);
		where.push(`(chat_id = ${param(q)} OR username ILIKE ${like} OR first_name ILIKE ${like})`);
	}
	if (filters.status) where.push(`status = ${param(filters.status)}`);
	if (filters.platform === 'olx') where.push('olx_active > 0');
	if (filters.platform === 'ebay') where.push('ebay_active > 0');
	if (filters.platform === 'none') where.push('olx_active + ebay_active = 0');
	if (filters.plan) where.push(`plan_code = ${param(filters.plan)}`);
	if (filters.regFrom || filters.regTo) {
		const tzParam = param(tz);
		if (filters.regFrom) where.push(`created_at >= (${param(filters.regFrom)}::date)::timestamp AT TIME ZONE ${tzParam}`);
		if (filters.regTo) where.push(`created_at < (${param(filters.regTo)}::date + 1)::timestamp AT TIME ZONE ${tzParam}`);
	}

	const orderExpr = SORTS[filters.sort] ?? SORTS.created_at;
	const dir = filters.dir === 'asc' ? 'ASC' : 'DESC';
	const limit = param(filters.pageSize);
	const offset = param((filters.page - 1) * filters.pageSize);

	const { rows } = await db.query(
		`WITH ${BASE_CTE}
		SELECT *, count(*) OVER () AS total_count
		FROM base
		${where.length ? 'WHERE ' + where.join(' AND ') : ''}
		ORDER BY ${orderExpr} ${dir} NULLS LAST, chat_id
		LIMIT ${limit} OFFSET ${offset}`,
		params
	);

	const total = rows.length ? Number(rows[0].total_count) : 0;
	if (rows.length === 0 && filters.page > 1) {
		// past the last page: report the real total so the pager can recover
		const { rows: c } = await db.query(
			`WITH ${BASE_CTE} SELECT count(*)::int AS n FROM base ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`,
			params.slice(0, -2)
		);
		return { rows, total: c[0].n };
	}
	return { rows, total };
}

export async function getUser(db, chatId) {
	const { rows } = await db.query(`WITH ${BASE_CTE} SELECT * FROM base WHERE chat_id = $1`, [chatId]);
	return rows[0] ?? null;
}

export async function getUserSearches(db, chatId) {
	const { rows } = await db.query(
		`SELECT id, source, query, category_id, min_price, max_price, condition, buying_option, us_only,
			active, created_at, last_notified_at
		 FROM searches WHERE chat_id = $1 ORDER BY created_at DESC`,
		[chatId]
	);
	return rows;
}

export async function getUserNotifications(db, chatId, limit = 50) {
	const { rows } = await db.query(
		`SELECT id, search_id, platform, kind, title, url, status, error, created_at, sent_at
		 FROM notification_log WHERE chat_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2`,
		[chatId, limit]
	);
	return rows;
}

export async function getUserErrors(db, chatId, limit = 50) {
	const { rows } = await db.query(
		'SELECT id, kind, message, created_at FROM user_errors WHERE chat_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2',
		[chatId, limit]
	);
	return rows;
}

export async function getUserSubscriptions(db, chatId) {
	const { rows: current } = await db.query(
		`SELECT cs.*, p.code AS plan_code, p.name AS plan_name
		 FROM current_subscriptions cs JOIN plans p ON p.id = cs.plan_id
		 WHERE cs.chat_id = $1`,
		[chatId]
	);
	const { rows: history } = await db.query(
		`SELECT s.*, p.code AS plan_code, p.name AS plan_name
		 FROM subscriptions s JOIN plans p ON p.id = s.plan_id
		 WHERE s.chat_id = $1 ORDER BY s.created_at DESC, s.id DESC LIMIT 20`,
		[chatId]
	);
	return { current: current[0] ?? null, history };
}

// Raw provider payloads are deliberately not selected: the panel shows
// identifiers and amounts only.
export async function getUserPayments(db, chatId) {
	const { rows } = await db.query(
		`SELECT pm.id, pm.amount_minor, pm.currency, pm.provider, pm.external_id, pm.status,
			pm.created_at, pm.paid_at, p.name AS plan_name
		 FROM payments pm LEFT JOIN plans p ON p.id = pm.plan_id
		 WHERE pm.chat_id = $1 ORDER BY pm.created_at DESC, pm.id DESC LIMIT 50`,
		[chatId]
	);
	return rows;
}
