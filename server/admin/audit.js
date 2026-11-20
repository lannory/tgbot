// Every admin action goes through here, ideally inside the same transaction
// as the change itself, so the log and the data can't disagree.
export async function writeAudit(db, { admin, action, targetType = null, targetId = null, reason = null, details = null, ip = null }) {
	await db.query(
		`INSERT INTO admin_audit_log (admin, action, target_type, target_id, reason, details, ip)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		[admin, action, targetType, targetId != null ? String(targetId) : null, reason, details ? JSON.stringify(details) : null, ip]
	);
}

export function actor(req) {
	return { admin: req.session.admin, ip: req.ip ?? null };
}
