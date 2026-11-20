import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';

import { setupTestDb, skipReason } from './helpers.js';

let t;
let app;

describe('bot activity tracking API', { skip: skipReason }, () => {
	before(async () => {
		t = await setupTestDb();
		const { botUsersRouter } = await import('../routes/botUsers.js');
		app = express();
		app.use(express.json());
		app.use(botUsersRouter());
	});

	after(async () => {
		await t?.cleanup();
	});

	it('creates the user on first touch and refreshes last_seen later', async () => {
		const res = await request(app).post('/users/touch')
			.send({ chatId: 555, username: 'neo', firstName: 'Thomas', languageCode: 'en', lang: 'en' });
		assert.equal(res.status, 200);
		assert.deepEqual(res.body, { blocked: false });

		const { rows } = await t.pool.query(`SELECT * FROM bot_users WHERE chat_id = '555'`);
		assert.equal(rows[0].username, 'neo');
		assert.equal(rows[0].lang, 'en');
		assert.ok(rows[0].created_at);
		assert.ok(rows[0].last_seen_at);

		await t.pool.query(`UPDATE bot_users SET last_seen_at = now() - interval '1 day', created_at = now() - interval '9 days' WHERE chat_id = '555'`);
		await request(app).post('/users/touch').send({ chatId: 555, username: 'neo2' });
		const { rows: after } = await t.pool.query(`SELECT * FROM bot_users WHERE chat_id = '555'`);
		assert.equal(after[0].username, 'neo2');
		assert.equal(after[0].lang, 'en', 'lang is kept when not sent');
		assert.ok(Date.now() - after[0].last_seen_at.getTime() < 60_000);
		assert.ok(Date.now() - after[0].created_at.getTime() > 8 * 86_400_000, 'created_at is kept');

		const { rows: days } = await t.pool.query(`SELECT count(*)::int AS n FROM user_activity_daily WHERE chat_id = '555'`);
		assert.equal(days[0].n, 1);
	});

	it('validates input', async () => {
		assert.equal((await request(app).post('/users/touch').send({})).status, 400);
		assert.equal((await request(app).post('/users/touch').send({ chatId: 'abc' })).status, 400);
		assert.equal((await request(app).post('/users/status').send({ chatId: 1, status: 'weird' })).status, 400);
		assert.equal((await request(app).post('/notifications/report').send({ results: 'x' })).status, 400);
	});

	it('reports admin blocking to the bot', async () => {
		await t.pool.query(`UPDATE bot_users SET admin_blocked_at = now() WHERE chat_id = '555'`);
		const res = await request(app).post('/users/touch').send({ chatId: 555 });
		assert.deepEqual(res.body, { blocked: true });
	});

	it('tracks blocking/unblocking the bot via my_chat_member', async () => {
		await request(app).post('/users/status').send({ chatId: 777, status: 'bot_blocked' });
		let { rows } = await t.pool.query(`SELECT bot_blocked_at FROM bot_users WHERE chat_id = '777'`);
		assert.ok(rows[0].bot_blocked_at);

		await request(app).post('/users/status').send({ chatId: 777, status: 'active' });
		({ rows } = await t.pool.query(`SELECT bot_blocked_at FROM bot_users WHERE chat_id = '777'`));
		assert.equal(rows[0].bot_blocked_at, null);
	});

	it('logs notifications and records delivery results reported by the bot', async () => {
		const { rows: s } = await t.pool.query(`INSERT INTO searches (chat_id, query, source) VALUES ('888', 'q', 'olx') RETURNING id`);
		const searchId = s[0].id;
		await t.db.enqueueNotification('888', searchId, { source: 'olx', title: 'Bike', itemWebUrl: 'https://olx.ua/1' });
		await t.db.enqueueNotification('888', searchId, { source: 'olx', title: 'Car', itemWebUrl: 'https://olx.ua/2' });

		const { rows: search } = await t.pool.query('SELECT last_notified_at FROM searches WHERE id = $1', [searchId]);
		assert.ok(search[0].last_notified_at);

		const groups = await t.db.popAllNotifications();
		const items = groups.find((g) => g.chatId === '888').items;
		assert.equal(items.length, 2);
		assert.ok(items.every((i) => i._logId));

		const res = await request(app).post('/notifications/report').send({
			results: [
				{ chatId: '888', logId: items[0]._logId, ok: true },
				{ chatId: '888', logId: items[1]._logId, ok: false, blocked: true, error: 'Forbidden: bot was blocked by the user' },
			],
		});
		assert.equal(res.status, 200);

		const { rows: log } = await t.pool.query(`SELECT title, status, error, platform FROM notification_log WHERE chat_id = '888' ORDER BY id`);
		assert.deepEqual(log.map((l) => [l.title, l.status, l.platform]), [['Bike', 'sent', 'olx'], ['Car', 'failed', 'olx']]);
		assert.match(log[1].error, /blocked/);

		const { rows: user } = await t.pool.query(`SELECT bot_blocked_at FROM bot_users WHERE chat_id = '888'`);
		assert.ok(user[0].bot_blocked_at, 'user is marked as having blocked the bot');
		const { rows: errors } = await t.pool.query(`SELECT kind FROM user_errors WHERE chat_id = '888'`);
		assert.deepEqual(errors.map((e) => e.kind), ['bot_blocked']);

		// polling skips users who blocked the bot
		const pollable = await t.db.listPollableSearches();
		assert.equal(pollable.some((p) => p.chat_id === '888'), false);

		// any new interaction clears the flag and polling resumes
		await request(app).post('/users/touch').send({ chatId: 888 });
		assert.equal((await t.db.listPollableSearches()).some((p) => p.chat_id === '888'), true);
	});

	it('ignores report entries for another chat', async () => {
		await t.db.enqueueNotification('901', null, { title: 'x' });
		const [{ items }] = (await t.db.popAllNotifications()).filter((g) => g.chatId === '901');
		await request(app).post('/notifications/report').send({ results: [{ chatId: '902', logId: items[0]._logId, ok: true }] });
		const { rows } = await t.pool.query('SELECT status FROM notification_log WHERE id = $1', [items[0]._logId]);
		assert.equal(rows[0].status, 'queued');
	});
});
