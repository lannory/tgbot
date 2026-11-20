import express from 'express';

import { touchUser, setBotBlocked, recordDeliveryResults } from '../users.js';

const CHAT_ID_RE = /^-?\d{1,20}$/;
const MAX_REPORT_ITEMS = 1000;

function validChatId(value) {
	return value != null && CHAT_ID_RE.test(String(value));
}

// Endpoints the Telegram bot calls to report user activity and delivery
// results. Failures here must never break the bot, so the bot treats every
// call as best-effort.
export function botUsersRouter() {
	const router = express.Router();

	router.post('/users/touch', async (req, res) => {
		const { chatId, username, firstName, languageCode, lang } = req.body ?? {};
		if (!validChatId(chatId)) {
			return res.status(400).json({ error: 'chatId is required' });
		}

		const result = await touchUser(String(chatId), { username, firstName, languageCode, lang });
		res.json(result);
	});

	router.post('/users/status', async (req, res) => {
		const { chatId, status } = req.body ?? {};
		if (!validChatId(chatId) || !['bot_blocked', 'active'].includes(status)) {
			return res.status(400).json({ error: 'chatId and status (bot_blocked | active) are required' });
		}

		await setBotBlocked(String(chatId), status === 'bot_blocked');
		res.json({ ok: true });
	});

	router.post('/notifications/report', async (req, res) => {
		const { results } = req.body ?? {};
		if (!Array.isArray(results) || results.length > MAX_REPORT_ITEMS) {
			return res.status(400).json({ error: `results must be an array of at most ${MAX_REPORT_ITEMS} items` });
		}

		const clean = [];
		for (const r of results) {
			if (!r || !validChatId(r.chatId)) continue;
			clean.push({
				chatId: String(r.chatId),
				logId: r.logId != null && /^\d{1,19}$/.test(String(r.logId)) ? String(r.logId) : null,
				ok: r.ok === true,
				skipped: r.skipped === true,
				blocked: r.blocked === true,
				error: typeof r.error === 'string' ? r.error : null,
			});
		}

		await recordDeliveryResults(clean);
		res.json({ ok: true, recorded: clean.length });
	});

	return router;
}
