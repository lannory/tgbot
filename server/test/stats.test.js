import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { setupTestDb, skipReason } from './helpers.js';

const TZ = 'Europe/Kyiv';

let t;
let stats;
let users;

const BASE_FILTERS = { q: '', status: '', platform: '', plan: '', regFrom: '', regTo: '', sort: 'created_at', dir: 'desc', page: 1, pageSize: 25 };

describe('admin statistics queries', { skip: skipReason }, () => {
	before(async () => {
		t = await setupTestDb();
		stats = await import('../admin/queries/stats.js');
		users = await import('../admin/queries/users.js');
		const q = (sql, params) => t.pool.query(sql, params);

		// 5 users: registered now / 3 days ago / 20 days ago / 60 days ago; one blocked the bot, one admin-blocked
		await q(`INSERT INTO bot_users (chat_id, username, first_name, created_at, last_seen_at, bot_blocked_at, admin_blocked_at) VALUES
			('1', 'alice', 'Alice', now(),                     now(),                     NULL,  NULL),
			('2', 'bob',   'Bob',   now() - interval '3 days',  now() - interval '2 days',  NULL,  NULL),
			('3', 'carol', 'Carol', now() - interval '20 days', now() - interval '20 days', now(), NULL),
			('4', NULL,    'Dan',   now() - interval '60 days', now() - interval '45 days', NULL,  now()),
			('5', 'eve_x', 'Eve',   now() - interval '60 days', NULL,                       NULL,  NULL)`);

		await q(`INSERT INTO searches (chat_id, query, source, active) VALUES
			('1', 'a', 'olx', true), ('1', 'b', 'ebay', true), ('1', 'c', 'ebay', false),
			('2', 'd', 'olx', true), ('2', 'e', 'olx', true),
			('3', 'f', 'ebay', true)`);

		await q(`INSERT INTO notification_log (chat_id, platform, status, created_at) VALUES
			('1', 'olx', 'sent', now()), ('1', 'olx', 'sent', now()), ('1', 'ebay', 'failed', now()),
			('2', 'olx', 'sent', now() - interval '3 days'), ('2', 'olx', 'sent', now() - interval '10 days'),
			('2', 'olx', 'queued', now())`);

		await q(`INSERT INTO user_activity_daily (chat_id, day) VALUES
			('1', (now() AT TIME ZONE '${TZ}')::date), ('2', (now() AT TIME ZONE '${TZ}')::date),
			('2', (now() AT TIME ZONE '${TZ}')::date - 1)`);

		const { rows: plan } = await q(`INSERT INTO plans (code, name, price_minor, currency, duration_days, max_searches)
			VALUES ('pro', 'Pro', 9900, 'UAH', 30, 50) RETURNING id`);
		await q(`INSERT INTO subscriptions (chat_id, plan_id, status, source, started_at, ends_at) VALUES
			('1', $1, 'active', 'payment', now() - interval '25 days', now() + interval '5 days'),
			('2', $1, 'active', 'manual',  now() - interval '1 day',   now() + interval '29 days'),
			('3', $1, 'expired', 'payment', now() - interval '90 days', now() - interval '60 days')`, [plan[0].id]);
		await q(`INSERT INTO payments (chat_id, plan_id, amount_minor, currency, provider, external_id, status, paid_at) VALUES
			('1', $1, 9900, 'UAH', 'mock', 'p1', 'paid', now()),
			('2', $1, 9900, 'UAH', 'mock', 'p2', 'paid', now()),
			('2', $1, 500,  'XTR', 'mock', 'p3', 'paid', now()),
			('3', $1, 9900, 'UAH', 'mock', 'p4', 'paid', now() - interval '70 days'),
			('3', $1, 9900, 'UAH', 'mock', 'p5', 'failed', now())`, [plan[0].id]);
	});

	after(async () => {
		await t?.cleanup();
	});

	it('counts users, new and active by period, and blocked', async () => {
		const u = await stats.getUserStats(t.pool, TZ);
		assert.equal(u.total, 5);
		assert.equal(u.new_today, 1);
		assert.equal(u.new_7d, 2);
		assert.equal(u.new_30d, 3);
		assert.equal(u.active_24h, 1);
		assert.equal(u.active_7d, 2);
		assert.equal(u.active_30d, 3);
		assert.equal(u.bot_blocked, 1);
		assert.equal(u.admin_blocked, 1);
	});

	it('counts active searches per platform', async () => {
		const s = await stats.getSearchStats(t.pool);
		assert.deepEqual(s, { active_total: 5, active_olx: 3, active_ebay: 2, total: 6 });
	});

	it('counts delivered notifications for today and 7 days', async () => {
		const n = await stats.getNotificationStats(t.pool, TZ);
		assert.equal(n.sent_today, 2);
		assert.equal(n.sent_7d, 3);
		assert.equal(n.failed_today, 1);
	});

	it('builds a 30-day series ending today', async () => {
		const series = await stats.getDailySeries(t.pool, TZ, 30);
		assert.equal(series.length, 30);
		const today = series.at(-1);
		assert.match(today.day, /^\d{4}-\d{2}-\d{2}$/);
		assert.equal(today.new_users, 1);
		assert.equal(today.active_users, 2);
		assert.equal(series.at(-2).active_users, 1);
		assert.equal(series.reduce((a, d) => a + d.new_users, 0), 3);
	});

	it('reports paying users, monthly revenue per currency and expiring subscriptions', async () => {
		const b = await stats.getBillingStats(t.pool, TZ);
		assert.equal(b.paidUsers, 2);
		assert.deepEqual(b.revenue, [
			{ currency: 'UAH', totalMinor: 19800, payments: 2 },
			{ currency: 'XTR', totalMinor: 500, payments: 1 },
		]);
		assert.deepEqual(b.expiring.map((e) => e.chat_id), ['1']);
	});

	it('lists users with search counts, plan and status', async () => {
		const { rows, total } = await users.listUsers(t.pool, BASE_FILTERS, TZ);
		assert.equal(total, 5);
		const alice = rows.find((r) => r.chat_id === '1');
		assert.equal(alice.olx_active, 1);
		assert.equal(alice.ebay_active, 1);
		assert.equal(alice.plan_code, 'pro');
		assert.equal(rows.find((r) => r.chat_id === '3').plan_code, 'free');
		assert.equal(rows.find((r) => r.chat_id === '3').status, 'bot_blocked');
		assert.equal(rows.find((r) => r.chat_id === '4').status, 'admin_blocked');
	});

	it('filters by text, status, platform, plan and registration date', async () => {
		const ids = async (f) => (await users.listUsers(t.pool, { ...BASE_FILTERS, ...f }, TZ)).rows.map((r) => r.chat_id).sort();

		assert.deepEqual(await ids({ q: '@ali' }), ['1']);
		assert.deepEqual(await ids({ q: 'dan' }), ['4']);
		assert.deepEqual(await ids({ q: '5' }), ['5']);
		assert.deepEqual(await ids({ q: '%' }), []);
		assert.deepEqual(await ids({ status: 'active' }), ['1', '2', '5']);
		assert.deepEqual(await ids({ platform: 'olx' }), ['1', '2']);
		assert.deepEqual(await ids({ platform: 'ebay' }), ['1', '3']);
		assert.deepEqual(await ids({ platform: 'none' }), ['4', '5']);
		assert.deepEqual(await ids({ plan: 'pro' }), ['1', '2']);
		assert.deepEqual(await ids({ plan: 'free' }), ['3', '4', '5']);

		const { rows: d } = await t.pool.query(`SELECT to_char((now() AT TIME ZONE $1)::date - 7, 'YYYY-MM-DD') AS d`, [TZ]);
		assert.deepEqual(await ids({ regFrom: d[0].d }), ['1', '2']);
		assert.deepEqual(await ids({ regTo: d[0].d }), ['3', '4', '5']);
	});

	it('sorts by any column and paginates on the server', async () => {
		const order = async (sort, dir) => (await users.listUsers(t.pool, { ...BASE_FILTERS, sort, dir }, TZ)).rows.map((r) => r.chat_id);

		assert.deepEqual(await order('chat_id', 'asc'), ['1', '2', '3', '4', '5']);
		assert.deepEqual(await order('username', 'asc'), ['1', '2', '3', '5', '4']); // NULL last
		assert.deepEqual((await order('olx', 'desc')).slice(0, 1), ['2']);
		assert.deepEqual(await order('last_seen_at', 'desc'), ['1', '2', '3', '4', '5']);

		const page1 = await users.listUsers(t.pool, { ...BASE_FILTERS, sort: 'chat_id', dir: 'asc', pageSize: 2, page: 1 }, TZ);
		const page3 = await users.listUsers(t.pool, { ...BASE_FILTERS, sort: 'chat_id', dir: 'asc', pageSize: 2, page: 3 }, TZ);
		const past = await users.listUsers(t.pool, { ...BASE_FILTERS, pageSize: 2, page: 9 }, TZ);
		assert.deepEqual(page1.rows.map((r) => r.chat_id), ['1', '2']);
		assert.deepEqual(page3.rows.map((r) => r.chat_id), ['5']);
		assert.equal(page1.total, 5);
		assert.equal(past.rows.length, 0);
		assert.equal(past.total, 5);
	});
});
