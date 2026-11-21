import express from 'express';

import { getDashboard } from '../queries/stats.js';
import { paymentsEnabled } from '../../billing/entitlements.js';
import { renderDailyChart } from '../chart.js';

export function dashboardRouter({ pool, config }) {
	const router = express.Router();

	router.get('/', async (req, res) => {
		const stats = await getDashboard(pool, config.timezone);
		res.render('dashboard', { stats, chartSvg: renderDailyChart(stats.series), paymentsEnabled: paymentsEnabled() });
	});

	return router;
}
