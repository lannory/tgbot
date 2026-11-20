import express from 'express';

import { pool } from '../db.js';
import { paymentsEnabled } from '../billing/entitlements.js';
import { applyWebhookEvent, createInvoice, PaymentError } from '../billing/payments.js';

function parseRawPayload(rawBody) {
	try {
		return JSON.parse(rawBody.toString('utf-8'));
	} catch {
		return { raw: rawBody.toString('utf-8').slice(0, 10_000) };
	}
}

// Payment provider webhooks. Must be mounted BEFORE express.json(), since
// signatures are verified against the exact raw body.
export function webhooksRouter({ providers, db = pool }) {
	const router = express.Router();

	router.post('/webhooks/payments/:provider', express.raw({ type: '*/*', limit: '256kb' }), async (req, res) => {
		const provider = providers.get(req.params.provider);
		if (!provider) return res.status(404).json({ error: 'unknown provider' });

		const request = { headers: req.headers, rawBody: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0) };
		if (!provider.verifyWebhook(request)) {
			console.log(`[payments] rejected ${provider.name} webhook: bad signature`);
			return res.status(401).json({ error: 'invalid signature' });
		}

		let event;
		try {
			event = provider.parseWebhook(request);
		} catch {
			return res.status(400).json({ error: 'malformed webhook' });
		}

		try {
			const result = await applyWebhookEvent(db, provider.name, event, parseRawPayload(request.rawBody));
			if (result.mismatch) console.log(`[payments] amount mismatch for ${provider.name}:${event.externalId}`);
			res.json({ ok: true, duplicate: Boolean(result.duplicate) });
		} catch (err) {
			if (err instanceof PaymentError) return res.status(err.status).json({ error: err.message });
			throw err;
		}
	});

	return router;
}

// Invoice creation for the bot. Disabled (404) while PAYMENTS_ENABLED is off.
export function billingRouter({ providers, db = pool }) {
	const router = express.Router();

	router.post('/billing/invoices', async (req, res) => {
		if (!paymentsEnabled()) return res.status(404).json({ error: 'payments are disabled' });

		const { chatId, planCode, provider: providerName } = req.body ?? {};
		const provider = providers.get(providerName);
		if (!chatId || typeof planCode !== 'string' || !provider) {
			return res.status(400).json({ error: 'chatId, planCode and a known provider are required' });
		}

		try {
			const { payment, payUrl } = await createInvoice(db, provider, { chatId: String(chatId), planCode });
			res.status(201).json({ paymentId: payment.id, payUrl });
		} catch (err) {
			if (err instanceof PaymentError) return res.status(err.status).json({ error: err.message });
			throw err;
		}
	});

	return router;
}
