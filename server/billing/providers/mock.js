import crypto from 'crypto';

import { PaymentProvider } from './provider.js';

export const MOCK_SIGNATURE_HEADER = 'x-mock-signature';

export function signMockPayload(secret, rawBody) {
	return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

// Local/test provider: invoices are fake, webhooks are JSON bodies signed
// with HMAC-SHA256(MOCK_PAYMENT_SECRET) in the x-mock-signature header.
// See scripts/mock-webhook.js to simulate a payment.
export class MockProvider extends PaymentProvider {
	constructor({ secret } = {}) {
		super();
		this.secret = secret ?? process.env.MOCK_PAYMENT_SECRET;
	}

	get name() {
		return 'mock';
	}

	async createInvoice({ paymentId, amountMinor, currency }) {
		const externalId = `mock_${crypto.randomUUID()}`;
		return {
			externalId,
			payUrl: `https://example.invalid/mock-pay/${externalId}`,
			raw: { paymentId, amountMinor, currency },
		};
	}

	verifyWebhook({ headers, rawBody }) {
		if (!this.secret || !Buffer.isBuffer(rawBody)) return false;
		const given = String(headers[MOCK_SIGNATURE_HEADER] ?? '');
		const expected = signMockPayload(this.secret, rawBody);
		const a = Buffer.from(given, 'utf-8');
		const b = Buffer.from(expected, 'utf-8');
		return a.length === b.length && crypto.timingSafeEqual(a, b);
	}

	parseWebhook({ rawBody }) {
		const body = JSON.parse(rawBody.toString('utf-8'));
		return {
			externalId: String(body.external_id),
			status: body.status,
			amountMinor: body.amount,
			currency: body.currency,
		};
	}
}
