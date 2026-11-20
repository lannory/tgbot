// Dashboard numbers. `tz` decides where "today" and "this month" start.

const TODAY_START = `(date_trunc('day', now() AT TIME ZONE $1) AT TIME ZONE $1)`;
const MONTH_START = `(date_trunc('month', now() AT TIME ZONE $1) AT TIME ZONE $1)`;

export async function getUserStats(db, tz) {
	const { rows } = await db.query(
		`SELECT
			count(*)::int AS total,
			count(*) FILTER (WHERE created_at >= ${TODAY_START})::int AS new_today,
			count(*) FILTER (WHERE created_at >= now() - interval '7 days')::int AS new_7d,
			count(*) FILTER (WHERE created_at >= now() - interval '30 days')::int AS new_30d,
			count(*) FILTER (WHERE last_seen_at >= now() - interval '24 hours')::int AS active_24h,
			count(*) FILTER (WHERE last_seen_at >= now() - interval '7 days')::int AS active_7d,
			count(*) FILTER (WHERE last_seen_at >= now() - interval '30 days')::int AS active_30d,
			count(*) FILTER (WHERE bot_blocked_at IS NOT NULL)::int AS bot_blocked,
			count(*) FILTER (WHERE admin_blocked_at IS NOT NULL)::int AS admin_blocked
		 FROM bot_users`,
		[tz]
	);
	return rows[0];
}

export async function getSearchStats(db) {
	const { rows } = await db.query(
		`SELECT
			count(*) FILTER (WHERE active)::int AS active_total,
			count(*) FILTER (WHERE active AND source = 'olx')::int AS active_olx,
			count(*) FILTER (WHERE active AND source = 'ebay')::int AS active_ebay,
			count(*)::int AS total
		 FROM searches`
	);
	return rows[0];
}

export async function getNotificationStats(db, tz) {
	const { rows } = await db.query(
		`SELECT
			count(*) FILTER (WHERE status = 'sent' AND created_at >= ${TODAY_START})::int AS sent_today,
			count(*) FILTER (WHERE status = 'sent')::int AS sent_7d,
			count(*) FILTER (WHERE status = 'failed' AND created_at >= ${TODAY_START})::int AS failed_today,
			count(*) FILTER (WHERE status = 'failed')::int AS failed_7d
		 FROM notification_log
		 WHERE created_at >= now() - interval '7 days'`,
		[tz]
	);
	return rows[0];
}

// New and active users per day for the last `days` days (days as YYYY-MM-DD)
export async function getDailySeries(db, tz, days = 30) {
	const { rows } = await db.query(
		`WITH days AS (
			SELECT generate_series(
				(now() AT TIME ZONE $1)::date - ($2::int - 1),
				(now() AT TIME ZONE $1)::date,
				interval '1 day'
			)::date AS day
		), new_users AS (
			SELECT (created_at AT TIME ZONE $1)::date AS day, count(*) AS c
			FROM bot_users
			WHERE created_at >= now() - make_interval(days => $2 + 1)
			GROUP BY 1
		), active_users AS (
			SELECT day, count(*) AS c
			FROM user_activity_daily
			WHERE day >= (now() AT TIME ZONE $1)::date - ($2::int - 1)
			GROUP BY 1
		)
		SELECT to_char(days.day, 'YYYY-MM-DD') AS day,
			COALESCE(new_users.c, 0)::int AS new_users,
			COALESCE(active_users.c, 0)::int AS active_users
		FROM days
		LEFT JOIN new_users USING (day)
		LEFT JOIN active_users USING (day)
		ORDER BY days.day`,
		[tz, days]
	);
	return rows;
}

export async function getBillingStats(db, tz) {
	const { rows: paid } = await db.query(
		`SELECT count(DISTINCT cs.chat_id)::int AS paid_users
		 FROM current_subscriptions cs
		 JOIN plans p ON p.id = cs.plan_id
		 WHERE p.price_minor > 0 AND cs.status = 'active'`
	);

	const { rows: revenue } = await db.query(
		`SELECT currency, sum(amount_minor)::bigint AS total_minor, count(*)::int AS payments
		 FROM payments
		 WHERE status = 'paid' AND paid_at >= ${MONTH_START}
		 GROUP BY currency
		 ORDER BY currency`,
		[tz]
	);

	const { rows: expiring } = await db.query(
		`SELECT cs.id, cs.chat_id, cs.status, cs.ends_at, p.name AS plan_name, u.username, u.first_name
		 FROM current_subscriptions cs
		 JOIN plans p ON p.id = cs.plan_id
		 LEFT JOIN bot_users u ON u.chat_id = cs.chat_id
		 WHERE cs.ends_at IS NOT NULL AND cs.ends_at <= now() + interval '7 days'
		 ORDER BY cs.ends_at
		 LIMIT 100`
	);

	return {
		paidUsers: paid[0].paid_users,
		revenue: revenue.map((r) => ({ currency: r.currency, totalMinor: Number(r.total_minor), payments: r.payments })),
		expiring,
	};
}

export async function getDashboard(db, tz) {
	const [users, searches, notifications, series, billing] = await Promise.all([
		getUserStats(db, tz),
		getSearchStats(db),
		getNotificationStats(db, tz),
		getDailySeries(db, tz, 30),
		getBillingStats(db, tz),
	]);
	return { users, searches, notifications, series, billing };
}
