import express from 'express';

import { listPlans } from '../queries/plans.js';
import { ActionError, savePlan } from '../actions.js';
import { actor } from '../audit.js';
import { parsePlanForm, positiveInt } from '../validate.js';

export function plansRouter({ pool }) {
	const router = express.Router();

	router.get('/plans', async (req, res) => {
		res.render('plans', { plans: await listPlans(pool) });
	});

	async function save(req, res, id) {
		const { plan, error } = parsePlanForm(req.body);
		try {
			if (error) throw new ActionError(error);
			await savePlan(pool, actor(req), { id, plan });
			req.session.flash = { type: 'ok', text: id == null ? 'Тариф створено' : 'Тариф збережено' };
		} catch (err) {
			if (!(err instanceof ActionError)) throw err;
			req.session.flash = { type: 'error', text: err.message };
		}
		res.redirect(303, '/plans');
	}

	router.post('/plans', (req, res) => save(req, res, null));

	router.post('/plans/:id', (req, res) => {
		const id = positiveInt(req.params.id);
		if (id == null) return res.status(404).render('error', { status: 404, message: 'Тариф не знайдено' });
		return save(req, res, id);
	});

	return router;
}
