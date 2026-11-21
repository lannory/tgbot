// Contract every payment provider implements. Real providers (Telegram Stars,
// plata by mono, LiqPay, WayForPay) go next to mock.js and are registered in
// index.js; nothing else in the code needs to know which one is used.
//
// Providers never see or return card data: only their own identifiers.

/**
 * @typedef {Object} Invoice
 * @property {string} externalId  provider's id of the invoice / order
 * @property {string|null} payUrl  where to send the user to pay (null if paid in-app)
 * @property {Object} [raw]        provider response, stored for debugging
 */

/**
 * @typedef {Object} WebhookEvent
 * @property {string} externalId   must match Invoice.externalId
 * @property {'pending'|'paid'|'failed'|'refunded'} status
 * @property {number} amountMinor  integer minor units
 * @property {string} currency     ISO 4217 code (or XTR for Telegram Stars)
 */

export class PaymentProvider {
	/** @returns {string} id used in URLs and payments.provider */
	get name() {
		throw new Error('not implemented');
	}

	/**
	 * @param {{ paymentId: string, chatId: string, amountMinor: number, currency: string, description: string }} order
	 * @returns {Promise<Invoice>}
	 */
	async createInvoice(order) {
		throw new Error('not implemented');
	}

	/**
	 * Checks the webhook signature against the raw request body.
	 * @param {{ headers: Object, rawBody: Buffer }} request
	 * @returns {boolean}
	 */
	verifyWebhook(request) {
		throw new Error('not implemented');
	}

	/**
	 * @param {{ headers: Object, rawBody: Buffer }} request
	 * @returns {WebhookEvent}
	 */
	parseWebhook(request) {
		throw new Error('not implemented');
	}
}
