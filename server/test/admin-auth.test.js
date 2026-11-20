import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import request from 'supertest';

import { setupTestDb, skipReason } from './helpers.js';

const USER = 'admin';
const PASSWORD = 'correct horse battery staple';

let t;
let createApp;
let loadConfig;

function makeConfig(overrides = {}) {
	return {
		...loadConfig({
			ADMIN_PANEL_USER: USER,
			ADMIN_PANEL_PASSWORD_HASH: bcrypt.hashSync(PASSWORD, 4),
			ADMIN_PANEL_SESSION_SECRET: 'x'.repeat(48),
		}),
		...overrides,
	};
}

function csrfFrom(html) {
	const m = html.match(/name="_csrf" value="([^"]+)"/);
	assert.ok(m, 'page has a CSRF field');
	return m[1];
}

async function login(agent, { username = USER, password = PASSWORD } = {}) {
	const page = await agent.get('/login');
	return agent.post('/login').type('form').send({ _csrf: csrfFrom(page.text), username, password });
}

const DATA_PAGES = ['/', '/users', '/users/1001', '/plans', '/audit', '/no-such-page'];
const ACTIONS = [
	'/users/1001/block',
	'/users/1001/unblock',
	'/users/1001/subscription/grant',
	'/users/1001/subscription/cancel',
	'/searches/1/disable',
	'/searches/1/delete',
	'/plans',
	'/plans/1',
	'/logout',
];

describe('admin panel auth', { skip: skipReason }, () => {
	let app;

	before(async () => {
		t = await setupTestDb();
		({ createApp } = await import('../admin/app.js'));
		({ loadConfig } = await import('../admin/config.js'));
		app = createApp({ pool: t.pool, config: makeConfig(), log: () => {} });

		await t.pool.query(`INSERT INTO bot_users (chat_id, username, first_name) VALUES ('1001', 'secret_user', 'Hidden')`);
		await t.pool.query(`INSERT INTO searches (chat_id, query, source) VALUES ('1001', 'gopro', 'ebay')`);
	});

	after(async () => {
		await t?.cleanup();
	});

	it('refuses to start without credentials in env', () => {
		assert.throws(() => loadConfig({}), /ADMIN_PANEL_USER/);
		assert.throws(() => loadConfig({ ADMIN_PANEL_USER: 'a', ADMIN_PANEL_PASSWORD_HASH: 'plain', ADMIN_PANEL_SESSION_SECRET: 'x'.repeat(40) }), /bcrypt/);
	});

	it('redirects every page to /login without a session and leaks no data', async () => {
		for (const path of DATA_PAGES) {
			const res = await request(app).get(path).set('Accept', 'text/html');
			assert.equal(res.status, 303, path);
			assert.equal(res.headers.location, '/login', path);
			assert.doesNotMatch(res.text, /secret_user|Hidden|gopro/, path);
		}
	});

	it('answers 401 to non-HTML requests without a session', async () => {
		for (const path of DATA_PAGES) {
			const res = await request(app).get(path).set('Accept', 'application/json');
			assert.equal(res.status, 401, path);
		}
	});

	it('rejects every action without a session and changes nothing', async () => {
		for (const path of ACTIONS) {
			const res = await request(app).post(path).type('form').send({ reason: 'x', plan_id: '1', days: '30', code: 'x', name: 'x' });
			assert.equal(res.status, 401, path);
		}
		const { rows } = await t.pool.query(`SELECT admin_blocked_at FROM bot_users WHERE chat_id = '1001'`);
		assert.equal(rows[0].admin_blocked_at, null);
		const { rows: s } = await t.pool.query('SELECT count(*)::int AS n FROM searches');
		assert.equal(s[0].n, 1);
	});

	it('rejects login without the form token', async () => {
		const res = await request(app).post('/login').type('form').send({ username: USER, password: PASSWORD });
		assert.equal(res.status, 403);
		assert.equal(res.headers['set-cookie']?.some((c) => c.startsWith('admin.sid=')) ?? false, false);
	});

	it('rejects a wrong password and audits the attempt', async () => {
		const agent = request.agent(app);
		const res = await login(agent, { password: 'wrong password!!' });
		assert.equal(res.status, 401);
		assert.equal((await agent.get('/users').set('Accept', 'text/html')).status, 303);

		const { rows } = await t.pool.query(`SELECT * FROM admin_audit_log WHERE action = 'auth.login_failed'`);
		assert.ok(rows.length >= 1);
		assert.doesNotMatch(JSON.stringify(rows), /wrong password/);
	});

	it('rejects a wrong username', async () => {
		const res = await login(request.agent(app), { username: 'root' });
		assert.equal(res.status, 401);
	});

	it('logs in, sets a hardened session cookie and serves pages', async () => {
		const agent = request.agent(app);
		const res = await login(agent);
		assert.equal(res.status, 303);
		assert.equal(res.headers.location, '/');

		const cookie = res.headers['set-cookie'].find((c) => c.startsWith('admin.sid='));
		assert.ok(cookie);
		assert.match(cookie, /HttpOnly/i);
		assert.match(cookie, /SameSite=Strict/i);

		for (const path of ['/', '/users', '/users/1001', '/plans', '/audit']) {
			const page = await agent.get(path);
			assert.equal(page.status, 200, path);
		}
		const userPage = await agent.get('/users/1001');
		assert.match(userPage.text, /secret_user/);
	});

	it('marks the cookie Secure when served over HTTPS via the proxy', async () => {
		// supertest talks plain HTTP, so Secure cookies are passed back by hand
		const page = await request(app).get('/login').set('X-Forwarded-Proto', 'https');
		const formCookie = page.headers['set-cookie'].find((c) => c.startsWith('admin.lcsrf='));
		assert.match(formCookie, /;\s*Secure/i);
		const res = await request(app).post('/login').set('X-Forwarded-Proto', 'https')
			.set('Cookie', formCookie.split(';')[0]).type('form')
			.send({ _csrf: csrfFrom(page.text), username: USER, password: PASSWORD });
		assert.equal(res.status, 303);
		const cookie = res.headers['set-cookie'].find((c) => c.startsWith('admin.sid='));
		assert.match(cookie, /;\s*Secure/i);
	});

	it('requires the CSRF token for actions of a logged-in admin', async () => {
		const agent = request.agent(app);
		await login(agent);

		const noToken = await agent.post('/users/1001/block').type('form').send({ reason: 'spam' });
		assert.equal(noToken.status, 403);
		const badToken = await agent.post('/users/1001/block').type('form').send({ reason: 'spam', _csrf: 'forged' });
		assert.equal(badToken.status, 403);

		const { rows } = await t.pool.query(`SELECT admin_blocked_at FROM bot_users WHERE chat_id = '1001'`);
		assert.equal(rows[0].admin_blocked_at, null);

		const page = await agent.get('/users/1001');
		const ok = await agent.post('/users/1001/block').type('form').send({ reason: 'spam', _csrf: csrfFrom(page.text) });
		assert.equal(ok.status, 303);

		const { rows: after } = await t.pool.query(`SELECT admin_blocked_at, admin_block_reason FROM bot_users WHERE chat_id = '1001'`);
		assert.ok(after[0].admin_blocked_at);
		assert.equal(after[0].admin_block_reason, 'spam');

		const { rows: audit } = await t.pool.query(`SELECT * FROM admin_audit_log WHERE action = 'user.block'`);
		assert.equal(audit.length, 1);
		assert.equal(audit[0].admin, USER);
		assert.equal(audit[0].target_id, '1001');
		assert.equal(audit[0].reason, 'spam');
	});

	it('logs out and the old session no longer works', async () => {
		const agent = request.agent(app);
		await login(agent);
		const page = await agent.get('/');
		const out = await agent.post('/logout').type('form').send({ _csrf: csrfFrom(page.text) });
		assert.equal(out.status, 303);
		assert.equal((await agent.get('/').set('Accept', 'text/html')).status, 303);
	});

	it('sends security headers', async () => {
		const res = await request(app).get('/login');
		assert.match(res.headers['content-security-policy'], /default-src 'self'/);
		assert.match(res.headers['content-security-policy'], /frame-ancestors 'none'/);
		assert.equal(res.headers['x-powered-by'], undefined);
		assert.equal(res.headers['x-content-type-options'], 'nosniff');
		assert.equal(res.headers['cache-control'], 'no-store');
	});

	it('rate-limits failed logins', async () => {
		const limited = createApp({ pool: t.pool, config: makeConfig({ loginRateLimit: { windowMs: 60_000, limit: 3 } }), log: () => {} });
		const agent = request.agent(limited);
		for (let i = 0; i < 3; i++) {
			assert.equal((await login(agent, { password: 'nope nope nope' })).status, 401);
		}
		const blocked = await login(agent, { password: PASSWORD });
		assert.equal(blocked.status, 429);
	});
});
