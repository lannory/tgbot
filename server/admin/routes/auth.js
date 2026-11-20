import express from 'express';
import bcrypt from 'bcryptjs';
import { rateLimit } from 'express-rate-limit';

import { parseCookies, randomToken, requireAuth, requireCsrf, safeEqual } from '../security.js';
import { writeAudit } from '../audit.js';

const LOGIN_CSRF_COOKIE = 'admin.lcsrf';

// Used when the username is wrong, so a failed login takes the same time
// whether or not the user exists
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 10);

export function authRouter({ pool, config }) {
	const router = express.Router();

	// Before login there is no session, so the login form is protected with a
	// double-submit token: random value in a strict httpOnly cookie + form field
	function renderLogin(req, res, status = 200, error = null) {
		const token = randomToken();
		res.cookie(LOGIN_CSRF_COOKIE, token, {
			httpOnly: true,
			sameSite: 'strict',
			secure: config.cookieSecure === 'auto' ? req.secure : config.cookieSecure,
			path: '/login',
			maxAge: 60 * 60_000,
		});
		res.status(status).render('login', { loginCsrf: token, error });
	}

	const loginLimiter = rateLimit({
		windowMs: config.loginRateLimit.windowMs,
		limit: config.loginRateLimit.limit,
		standardHeaders: 'draft-7',
		legacyHeaders: false,
		skipSuccessfulRequests: true,
		handler: (req, res) => renderLogin(req, res, 429, 'Забагато спроб входу. Спробуйте пізніше.'),
	});

	router.get('/login', (req, res) => {
		if (req.session.admin) return res.redirect(303, '/');
		renderLogin(req, res);
	});

	router.post('/login', loginLimiter, async (req, res, next) => {
		try {
			const cookieToken = parseCookies(req.headers.cookie)[LOGIN_CSRF_COOKIE];
			if (!safeEqual(cookieToken, req.body?._csrf)) {
				return renderLogin(req, res, 403, 'Сесія форми застаріла. Спробуйте ще раз.');
			}

			const username = typeof req.body.username === 'string' ? req.body.username.trim().slice(0, 64) : '';
			const password = typeof req.body.password === 'string' ? req.body.password.slice(0, 200) : '';

			const userOk = safeEqual(username, config.user);
			const passwordOk = await bcrypt.compare(password, userOk ? config.passwordHash : DUMMY_HASH);

			if (!userOk || !passwordOk) {
				await writeAudit(pool, {
					admin: '(anonymous)',
					action: 'auth.login_failed',
					details: { username: username.slice(0, 32) },
					ip: req.ip,
				});
				return renderLogin(req, res, 401, 'Невірний логін або пароль');
			}

			// new session id on login (no session fixation)
			req.session.regenerate((err) => {
				if (err) return next(err);
				req.session.admin = config.user;
				req.session.csrfToken = randomToken();
				req.session.loginAt = new Date().toISOString();
				req.session.save(async (saveErr) => {
					if (saveErr) return next(saveErr);
					res.clearCookie(LOGIN_CSRF_COOKIE, { path: '/login' });
					await writeAudit(pool, { admin: config.user, action: 'auth.login', ip: req.ip }).catch(() => {});
					res.redirect(303, '/');
				});
			});
		} catch (err) {
			next(err);
		}
	});

	router.post('/logout', requireAuth, requireCsrf, async (req, res, next) => {
		const admin = req.session.admin;
		await writeAudit(pool, { admin, action: 'auth.logout', ip: req.ip }).catch(() => {});
		req.session.destroy((err) => {
			if (err) return next(err);
			res.clearCookie('admin.sid');
			res.redirect(303, '/login');
		});
	});

	return router;
}
