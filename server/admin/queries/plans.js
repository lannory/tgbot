export async function listPlans(db) {
	const { rows } = await db.query(
		`SELECT p.*,
			(SELECT count(*)::int FROM current_subscriptions cs WHERE cs.plan_id = p.id) AS current_subscribers
		 FROM plans p ORDER BY p.is_default DESC, p.price_minor, p.id`
	);
	return rows;
}

export async function listActivePlans(db) {
	const { rows } = await db.query('SELECT id, code, name, duration_days FROM plans WHERE is_active ORDER BY price_minor, id');
	return rows;
}

export async function listPlanCodes(db) {
	const { rows } = await db.query('SELECT code, name FROM plans ORDER BY price_minor, id');
	return rows;
}

export async function getPlan(db, id) {
	const { rows } = await db.query('SELECT * FROM plans WHERE id = $1', [id]);
	return rows[0] ?? null;
}
