export async function listAudit(db, { page, pageSize, targetType = null, targetId = null }) {
	const where = [];
	const params = [];
	if (targetType) {
		params.push(targetType);
		where.push(`target_type = $${params.length}`);
	}
	if (targetId) {
		params.push(targetId);
		where.push(`target_id = $${params.length}`);
	}
	params.push(pageSize, (page - 1) * pageSize);

	const { rows } = await db.query(
		`SELECT *, count(*) OVER () AS total_count FROM admin_audit_log
		 ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
		 ORDER BY created_at DESC, id DESC
		 LIMIT $${params.length - 1} OFFSET $${params.length}`,
		params
	);
	return { rows, total: rows.length ? Number(rows[0].total_count) : 0 };
}
