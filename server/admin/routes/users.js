import express from 'express';

import {
	listUsers, getUser, getUserSearches, getUserNotifications, getUserErrors, getUserSubscriptions, getUserPayments,
} from '../queries/users.js';
import { listPlanCodes, listActivePlans } from '../queries/plans.js';
import {
	ActionError, blockUser, unblockUser, setSearchActive, deleteSearch, grantManualSubscription, cancelSubscription,
} from '../actions.js';
import { actor } from '../audit.js';
import { CHAT_ID_RE, parseUserFilters, positiveInt, reasonFrom } from '../validate.js';

function flash(req, type, text) {
	req.session.flash = { type, text };
}

function userUrl(chatId) {
	return `/users/${encodeURIComponent(chatId)}`;
}

// Runs an admin action and redirects back with a flash message
async function runAction(req, res, back, fn, successText) {
	try {
		await fn();
		flash(req, 'ok', successText);
	} catch (err) {
		if (!(err instanceof ActionError)) throw err;
		flash(req, 'error', err.message);
	}
	res.redirect(303, back);
}

export function usersRouter({ pool, config }) {
	const router = express.Router();

	router.param('chatId', (req, res, next, value) => {
		if (!CHAT_ID_RE.test(value)) return res.status(404).render('error', { status: 404, message: 'Користувача не знайдено' });
		next();
	});
	router.param('searchId', (req, res, next, value) => {
		if (positiveInt(value) == null) return res.status(404).render('error', { status: 404, message: 'Пошук не знайдено' });
		next();
	});

	router.get('/users', async (req, res) => {
		const plans = await listPlanCodes(pool);
		const filters = parseUserFilters(req.query, plans.map((p) => p.code));
		const { rows, total } = await listUsers(pool, filters, config.timezone);
		res.render('users', { users: rows, total, filters, plans, pages: Math.max(1, Math.ceil(total / filters.pageSize)) });
	});

	router.get('/users/:chatId', async (req, res) => {
		const chatId = req.params.chatId;
		const user = await getUser(pool, chatId);
		if (!user) return res.status(404).render('error', { status: 404, message: 'Користувача не знайдено' });

		const [searches, notifications, errors, subscriptions, payments, plans] = await Promise.all([
			getUserSearches(pool, chatId),
			getUserNotifications(pool, chatId),
			getUserErrors(pool, chatId),
			getUserSubscriptions(pool, chatId),
			getUserPayments(pool, chatId),
			listActivePlans(pool),
		]);
		res.render('user', { user, searches, notifications, errors, subscriptions, payments, plans });
	});

	router.post('/users/:chatId/block', async (req, res) => {
		const { chatId } = req.params;
		const { reason, error } = reasonFrom(req.body, { required: true });
		if (error) {
			flash(req, 'error', error);
			return res.redirect(303, userUrl(chatId));
		}
		await runAction(req, res, userUrl(chatId), () => blockUser(pool, actor(req), { chatId, reason }), 'Користувача заблоковано');
	});

	router.post('/users/:chatId/unblock', async (req, res) => {
		const { chatId } = req.params;
		const { reason } = reasonFrom(req.body);
		await runAction(req, res, userUrl(chatId), () => unblockUser(pool, actor(req), { chatId, reason }), 'Користувача розблоковано');
	});

	router.post('/users/:chatId/subscription/grant', async (req, res) => {
		const { chatId } = req.params;
		const back = userUrl(chatId);
		const { reason, error } = reasonFrom(req.body, { required: true });
		const planId = positiveInt(req.body.plan_id);
		const days = positiveInt(req.body.days, { max: 3650 });
		if (error || planId == null || days == null) {
			flash(req, 'error', error ?? 'Оберіть тариф і кількість днів (1–3650)');
			return res.redirect(303, back);
		}
		await runAction(req, res, back,
			() => grantManualSubscription(pool, actor(req), { chatId, planId, days, reason }),
			'Підписку видано / продовжено');
	});

	router.post('/users/:chatId/subscription/cancel', async (req, res) => {
		const { chatId } = req.params;
		const { reason, error } = reasonFrom(req.body, { required: true });
		if (error) {
			flash(req, 'error', error);
			return res.redirect(303, userUrl(chatId));
		}
		await runAction(req, res, userUrl(chatId), () => cancelSubscription(pool, actor(req), { chatId, reason }), 'Підписку скасовано');
	});

	async function searchOwner(searchId) {
		const { rows } = await pool.query('SELECT chat_id FROM searches WHERE id = $1', [searchId]);
		return rows[0]?.chat_id ?? null;
	}

	for (const [path, active] of [['disable', false], ['enable', true]]) {
		router.post(`/searches/:searchId/${path}`, async (req, res) => {
			const searchId = Number(req.params.searchId);
			const owner = await searchOwner(searchId);
			const { reason } = reasonFrom(req.body);
			await runAction(req, res, owner ? userUrl(owner) : '/users',
				() => setSearchActive(pool, actor(req), { searchId, active, reason }),
				active ? 'Пошук увімкнено' : 'Пошук вимкнено');
		});
	}

	router.post('/searches/:searchId/delete', async (req, res) => {
		const searchId = Number(req.params.searchId);
		const owner = await searchOwner(searchId);
		const { reason } = reasonFrom(req.body);
		await runAction(req, res, owner ? userUrl(owner) : '/users',
			() => deleteSearch(pool, actor(req), { searchId, reason }),
			'Пошук видалено');
	});

	return router;
}
