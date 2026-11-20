import { withTransaction } from '../lib/tx.js';
import { grantSubscription } from './subscriptions.js';

export class PaymentError extends Error {
	constructor(status, message) {
		super(message);
		this.status = status;
	}
}

// Creates a pending payment and the provider invoice for it.
export async function createInvoice(pool, provider, { chatId, planCode }) {
	const { rows: plans } = await pool.query(
		'SELECT * FROM plans WHERE code = $1 AND is_active AND price_minor > 0',
		[planCode]
	);
	const plan = plans[0];
	if (!plan) throw new PaymentError(404, 'plan not found or not purchasable');

	const invoice = await provider.createInvoice({
		paymentId: null,
		chatId,
		amountMinor: plan.price_minor,
		currency: plan.currency,
		description: plan.name,
	});

	const { rows } = await pool.query(
		`INSERT INTO payments (chat_id, plan_id, amount_minor, currency, provider, external_id, status, raw_payload)
		 VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7) RETURNING *`,
		[chatId, plan.id, plan.price_minor, plan.currency, provider.name, invoice.externalId, JSON.stringify({ invoice: invoice.raw ?? null })]
	);
	return { payment: rows[0], payUrl: invoice.payUrl };
}

const ALLOWED_TRANSITIONS = {
	pending: ['paid', 'failed'],
	failed: ['paid'],
	paid: ['refunded'],
	refunded: [],
};

// Handles a verified webhook event. Idempotent: the payment row is locked,
// and the subscription is granted only on the transition into "paid", so a
// repeated webhook with the same external_id never extends twice.
export async function applyWebhookEvent(pool, providerName, event, rawPayload) {
	if (!event || typeof event.externalId !== 'string' || !event.externalId) {
		throw new PaymentError(400, 'webhook has no external id');
	}
	if (!['pending', 'paid', 'failed', 'refunded'].includes(event.status)) {
		throw new PaymentError(400, 'unknown payment status');
	}

	return withTransaction(pool, async (client) => {
		const { rows } = await client.query(
			'SELECT * FROM payments WHERE provider = $1 AND external_id = $2 FOR UPDATE',
			[providerName, event.externalId]
		);
		const payment = rows[0];
		if (!payment) throw new PaymentError(404, 'unknown payment');

		if (payment.status === event.status) {
			return { payment, changed: false, duplicate: true };
		}
		if (!ALLOWED_TRANSITIONS[payment.status].includes(event.status)) {
			return { payment, changed: false, ignored: `transition ${payment.status} -> ${event.status}` };
		}

		if (event.status === 'paid') {
			// never trust a webhook's amount over what we invoiced
			if (event.amountMinor !== payment.amount_minor || event.currency !== payment.currency) {
				await client.query(
					`UPDATE payments SET status = 'failed', raw_payload = $2, updated_at = now() WHERE id = $1`,
					[payment.id, JSON.stringify({ mismatch: true, webhook: rawPayload })]
				);
				return { payment, changed: true, mismatch: true };
			}

			const { rows: planRows } = await client.query('SELECT * FROM plans WHERE id = $1', [payment.plan_id]);
			const plan = planRows[0];
			const { subscription } = await grantSubscription(client, {
				chatId: payment.chat_id,
				planId: plan.id,
				days: plan.duration_days ?? 30,
				source: 'payment',
			});

			const { rows: updated } = await client.query(
				`UPDATE payments SET status = 'paid', paid_at = now(), subscription_id = $2, raw_payload = $3, updated_at = now()
				 WHERE id = $1 RETURNING *`,
				[payment.id, subscription.id, JSON.stringify(rawPayload)]
			);
			return { payment: updated[0], changed: true, subscription };
		}

		// failed / refunded: status only. Refunds do not revoke access
		// automatically; the admin can cancel the subscription in the panel.
		const { rows: updated } = await client.query(
			`UPDATE payments SET status = $2, raw_payload = $3, updated_at = now() WHERE id = $1 RETURNING *`,
			[payment.id, event.status, JSON.stringify(rawPayload)]
		);
		return { payment: updated[0], changed: true };
	});
}
