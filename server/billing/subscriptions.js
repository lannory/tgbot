// Subscription changes shared by payments (webhooks) and admin actions.
// All functions take a client that is already inside a transaction.

// Grants `days` of `planId`. If the chat already has a current subscription
// to the same plan, it is extended from its end date; otherwise other current
// subscriptions are cancelled and a new one starts now.
export async function grantSubscription(client, { chatId, planId, days, source, createdBy = null }) {
	if (!Number.isInteger(days) || days <= 0) throw new Error('days must be a positive integer');

	const { rows: current } = await client.query(
		`SELECT * FROM subscriptions
		 WHERE chat_id = $1 AND status IN ('active', 'trial')
			AND started_at <= now() AND (ends_at IS NULL OR ends_at > now())
		 FOR UPDATE`,
		[chatId]
	);

	const samePlan = current.find((s) => s.plan_id === planId);
	if (samePlan) {
		if (samePlan.ends_at == null) return { subscription: samePlan, extended: false };
		const { rows } = await client.query(
			`UPDATE subscriptions
			 SET ends_at = GREATEST(ends_at, now()) + make_interval(days => $2),
				status = CASE WHEN $3 = 'trial' THEN status ELSE 'active' END,
				updated_at = now()
			 WHERE id = $1 RETURNING *`,
			[samePlan.id, days, source]
		);
		return { subscription: rows[0], extended: true };
	}

	for (const s of current) {
		await client.query(`UPDATE subscriptions SET status = 'cancelled', updated_at = now() WHERE id = $1`, [s.id]);
	}

	const { rows } = await client.query(
		`INSERT INTO subscriptions (chat_id, plan_id, status, source, started_at, ends_at, created_by)
		 VALUES ($1, $2, $3, $4, now(), now() + make_interval(days => $5), $6)
		 RETURNING *`,
		[chatId, planId, source === 'trial' ? 'trial' : 'active', source, days, createdBy]
	);
	return { subscription: rows[0], extended: false, cancelled: current.map((s) => s.id) };
}

export async function cancelCurrentSubscriptions(client, chatId) {
	const { rows } = await client.query(
		`UPDATE subscriptions SET status = 'cancelled', updated_at = now()
		 WHERE chat_id = $1 AND status IN ('active', 'trial') AND (ends_at IS NULL OR ends_at > now())
		 RETURNING id`,
		[chatId]
	);
	return rows.map((r) => r.id);
}

// Marks subscriptions past their end date as expired (status bookkeeping only:
// entitlements already ignore them via current_subscriptions)
export async function expireSubscriptions(db) {
	const { rowCount } = await db.query(
		`UPDATE subscriptions SET status = 'expired', updated_at = now()
		 WHERE status IN ('active', 'trial') AND ends_at IS NOT NULL AND ends_at <= now()`
	);
	return rowCount;
}
