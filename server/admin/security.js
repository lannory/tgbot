import crypto from 'crypto';

export function randomToken() {
	return crypto.randomBytes(32).toString('base64url');
}

export function safeEqual(a, b) {
	const x = Buffer.from(String(a ?? ''), 'utf-8');
	const y = Buffer.from(String(b ?? ''), 'utf-8');
	return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

export function parseCookies(header) {
	const out = {};
	for (const part of String(header ?? '').split(';')) {
		const i = part.indexOf('=');
		if (i < 0) continue;
		const key = part.slice(0, i).trim();
		if (!key) continue;
		try {
			out[key] = decodeURIComponent(part.slice(i + 1).trim());
		} catch {
			out[key] = part.slice(i + 1).trim();
		}
	}
	return out;
}

export function wantsHtml(req) {
	return req.method === 'GET' && req.accepts(['html', 'json']) === 'html';
}

// Only authenticated admins pass. Pages redirect to the login form, anything
// else gets 401, and no data is produced either way.
export function requireAuth(req, res, next) {
	if (req.session?.admin) return next();
	if (wantsHtml(req)) return res.redirect(303, '/login');
	return res.status(401).json({ error: 'unauthorized' });
}

// Synchronizer-token CSRF check for every state-changing request of a
// logged-in admin. The token lives in the server-side session and is
// rendered into each form as `_csrf`.
export function requireCsrf(req, res, next) {
	if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
	const given = req.body?._csrf ?? req.get('x-csrf-token');
	if (safeEqual(given, req.session?.csrfToken)) return next();
	return res.status(403).render('error', { status: 403, message: 'Недійсний CSRF-токен. Оновіть сторінку і спробуйте ще раз.' });
}
