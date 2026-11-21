import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';

import { setupTestDb, skipReason } from './helpers.js';

const SECRET = 'test-webhook-secret';

let t;
let ent;
let mock;
let app;
let proPlanId;

function signedWebhook(body) {
	const raw = JSON.stringify(body);
	return request(app)
		.post('/webhooks/payments/mock')
		.set('Content-Type', 'application/json')
		.set(mock.MOCK_SIGNATURE_HEADER, mock.signMockPayload(SECRET, Buffer.from(raw)))
		.send(raw);
}

describe('entitlements and payments', { skip: skipReason }, () => {
	before(async () => {
		t = await setupTestDb({ MAX_SEARCHES_PER_CHAT: '2', POLL_INTERVAL_MS: '90000' });
		ent = await import('../billing/entitlements.js');
		mock = await import('../billing/providers/mock.js');
		const { webhooksRouter } = await import('../routes/billing.js');

		const providers = new Map([['mock', new mock.MockProvider({ secret: SECRET })]]);
		app = express();
		app.use(webhooksRouter({ providers, db: t.pool }));

		const { rows } = await t.pool.query(`INSERT INTO plans (code, name, price_minor, currency, duration_days, max_searches, platforms, check_interval_sec)
			VALUES ('pro', 'Pro', 9900, 'UAH', 30, 10, ARRAY['ebay'], 30) RETURNING id`);
		proPlanId = rows[0].id;
		await t.pool.query(`INSERT INTO searches (chat_id, query, source) VALUES ('7', 'a', 'olx'), ('7', 'b', 'ebay')`);
	});

	after(async () => {
		await t?.cleanup();
	});

	beforeEach(() => {
		delete process.env.PAYMENTS_ENABLED;
	});

	it('seeds a default free plan that covers what users already have', async () => {
		const { rows } = await t.pool.query('SELECT * FROM plans WHERE is_default');
		assert.equal(rows.length, 1);
		assert.equal(rows[0].code, 'free');
		assert.equal(rows[0].price_minor, 0);
		assert.deepEqual(rows[0].platforms, ['ebay', 'olx']);
		assert.ok(rows[0].max_searches >= 5);
	});

	it('keeps the legacy behaviour while PAYMENTS_ENABLED is off', async () => {
		assert.equal(ent.paymentsEnabled(), false);
		const res = await ent.canCreateSearch('7', 'olx');
		assert.deepEqual(res, { ok: false, code: 'search_limit', error: 'Max 2 searches per chat' });
		assert.deepEqual(await ent.canCreateSearch('8', 'olx'), { ok: true });
		assert.equal(await ent.getCheckInterval('7'), 90_000);
		assert.equal(await ent.canUsePlatform('7', 'olx'), true);
	});

	it('applies plan limits once PAYMENTS_ENABLED=true', async () => {
		process.env.PAYMENTS_ENABLED = 'true';
		// free plan: default limit (>= 5) and 90 s interval
		assert.deepEqual(await ent.canCreateSearch('7', 'olx'), { ok: true });
		assert.equal(await ent.getCheckInterval('7'), 90_000);
		assert.equal((await ent.getUserPlan('7')).code, 'free');

		await t.pool.query(`INSERT INTO subscriptions (chat_id, plan_id, status, source, ends_at)
			VALUES ('9', $1, 'active', 'manual', now() + interval '1 day')`, [proPlanId]);
		assert.equal((await ent.getUserPlan('9')).code, 'pro');
		assert.equal(await ent.getCheckInterval('9'), 30_000);
		assert.equal((await ent.canCreateSearch('9', 'olx')).code, 'platform_not_in_plan');
		assert.equal(await ent.canUsePlatform('9', 'olx'), false);

		const intervals = await ent.getCheckIntervals(['7', '9']);
		assert.equal(intervals.get('7'), 90_000);
		assert.equal(intervals.get('9'), 30_000);
	});

	it('rejects webhooks with a bad signature', async () => {
		const res = await request(app)
			.post('/webhooks/payments/mock')
			.set('Content-Type', 'application/json')
			.set(mock.MOCK_SIGNATURE_HEADER, 'deadbeef')
			.send(JSON.stringify({ external_id: 'x', status: 'paid', amount: 1, currency: 'UAH' }));
		assert.equal(res.status, 401);
		const unknown = await request(app).post('/webhooks/payments/nope').send('{}');
		assert.equal(unknown.status, 404);
	});

	it('extends the subscription only once for a repeated webhook', async () => {
		const { createInvoice } = await import('../billing/payments.js');
		const provider = new mock.MockProvider({ secret: SECRET });
		const { payment } = await createInvoice(t.pool, provider, { chatId: '20', planCode: 'pro' });
		assert.equal(payment.status, 'pending');
		assert.equal(payment.amount_minor, 9900);

		const body = { external_id: payment.external_id, status: 'paid', amount: 9900, currency: 'UAH' };
		const first = await signedWebhook(body);
		assert.equal(first.status, 200);
		assert.equal(first.body.duplicate, false);

		const sub1 = (await t.pool.query(`SELECT * FROM subscriptions WHERE chat_id = '20'`)).rows;
		assert.equal(sub1.length, 1);
		assert.equal(sub1[0].source, 'payment');

		const second = await signedWebhook(body);
		assert.equal(second.status, 200);
		assert.equal(second.body.duplicate, true);

		const sub2 = (await t.pool.query(`SELECT * FROM subscriptions WHERE chat_id = '20'`)).rows;
		assert.equal(sub2.length, 1);
		assert.equal(sub2[0].ends_at.getTime(), sub1[0].ends_at.getTime());

		const { rows: pay } = await t.pool.query('SELECT * FROM payments WHERE id = $1', [payment.id]);
		assert.equal(pay[0].status, 'paid');
		assert.equal(pay[0].subscription_id, sub1[0].id);
		assert.equal(pay[0].raw_payload.external_id, payment.external_id);
	});

	it('handles concurrent duplicate webhooks without double extension', async () => {
		const { createInvoice } = await import('../billing/payments.js');
		const provider = new mock.MockProvider({ secret: SECRET });
		const { payment } = await createInvoice(t.pool, provider, { chatId: '21', planCode: 'pro' });
		const body = { external_id: payment.external_id, status: 'paid', amount: 9900, currency: 'UAH' };

		const results = await Promise.all([signedWebhook(body), signedWebhook(body), signedWebhook(body)]);
		assert.deepEqual(results.map((r) => r.status), [200, 200, 200]);
		assert.equal(results.filter((r) => r.body.duplicate === false).length, 1);

		const { rows } = await t.pool.query(`SELECT ends_at - started_at AS len FROM subscriptions WHERE chat_id = '21'`);
		assert.equal(rows.length, 1);
		assert.equal(rows[0].len.days, 30);
	});

	it('a second paid invoice for the same plan extends from the current end date', async () => {
		const { createInvoice } = await import('../billing/payments.js');
		const provider = new mock.MockProvider({ secret: SECRET });
		const { payment } = await createInvoice(t.pool, provider, { chatId: '20', planCode: 'pro' });
		const before = (await t.pool.query(`SELECT ends_at FROM subscriptions WHERE chat_id = '20'`)).rows[0].ends_at;

		await signedWebhook({ external_id: payment.external_id, status: 'paid', amount: 9900, currency: 'UAH' });
		const { rows } = await t.pool.query(`SELECT ends_at FROM subscriptions WHERE chat_id = '20'`);
		assert.equal(rows.length, 1);
		assert.equal(rows[0].ends_at.getTime() - before.getTime(), 30 * 24 * 3600 * 1000);
	});

	it('does not grant anything when the paid amount does not match the invoice', async () => {
		const { createInvoice } = await import('../billing/payments.js');
		const provider = new mock.MockProvider({ secret: SECRET });
		const { payment } = await createInvoice(t.pool, provider, { chatId: '22', planCode: 'pro' });

		await signedWebhook({ external_id: payment.external_id, status: 'paid', amount: 1, currency: 'UAH' });
		const { rows } = await t.pool.query(`SELECT * FROM subscriptions WHERE chat_id = '22'`);
		assert.equal(rows.length, 0);
		const { rows: pay } = await t.pool.query('SELECT status FROM payments WHERE id = $1', [payment.id]);
		assert.equal(pay[0].status, 'failed');
	});

	it('returns 404 for an unknown external id', async () => {
		const res = await signedWebhook({ external_id: 'never-issued', status: 'paid', amount: 9900, currency: 'UAH' });
		assert.equal(res.status, 404);
	});
});

describe('money helpers', () => {
	it('parses and formats minor units without floats', async () => {
		const { parseMoney, formatMoney } = await import('../admin/format.js');
		assert.equal(parseMoney('99.5', 'UAH'), 9950);
		assert.equal(parseMoney('0,10', 'UAH'), 10);
		assert.equal(parseMoney('19.99', 'USD'), 1999);
		assert.equal(parseMoney('150', 'XTR'), 150);
		assert.equal(parseMoney('1.5', 'XTR'), null);
		assert.equal(parseMoney('1.234', 'UAH'), null);
		assert.equal(parseMoney('-1', 'UAH'), null);
		assert.equal(formatMoney(123450, 'UAH'), '1 234.50 UAH');
		assert.equal(formatMoney(5, 'USD'), '0.05 USD');
		assert.equal(formatMoney(500, 'XTR'), '500 XTR');
	});
});
