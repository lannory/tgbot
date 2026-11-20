import express from 'express';

import { listAudit } from '../queries/audit.js';
import { positiveInt } from '../validate.js';

const PAGE_SIZE = 50;
const TARGET_TYPES = ['user', 'search', 'plan'];

export function auditRouter({ pool }) {
	const router = express.Router();

	router.get('/audit', async (req, res) => {
		const page = positiveInt(req.query.page, { max: 100_000 }) ?? 1;
		const targetType = TARGET_TYPES.includes(req.query.target_type) ? req.query.target_type : null;
		const targetId = targetType && typeof req.query.target_id === 'string' ? req.query.target_id.slice(0, 40) : null;
		const { rows, total } = await listAudit(pool, { page, pageSize: PAGE_SIZE, targetType, targetId });
		res.render('audit', { rows, total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), targetType, targetId });
	});

	return router;
}
