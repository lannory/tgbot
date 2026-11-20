import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import helmet from 'helmet';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';

import { createFormatters } from './format.js';
import { requireAuth, requireCsrf } from './security.js';
import { authRouter } from './routes/auth.js';
import { dashboardRouter } from './routes/dashboard.js';
import { usersRouter } from './routes/users.js';
import { plansRouter } from './routes/plans.js';
import { auditRouter } from './routes/audit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const SESSION_COOKIE = 'admin.sid';

export function createApp({ pool, config, log = console.log }) {
	const app = express();
	const PgStore = connectPgSimple(session);

	app.set('trust proxy', config.trustProxy);
	app.set('view engine', 'ejs');
	app.set('views', path.join(__dirname, 'views'));

	// Minimal access log: no headers, cookies, bodies or query strings
	app.use((req, res, next) => {
		const started = Date.now();
		const path = req.originalUrl.split('?')[0];
		res.on('finish', () => log(`[admin] ${req.method} ${path} ${res.statusCode} ${Date.now() - started}ms`));
		next();
	});

	app.use(helmet({
		contentSecurityPolicy: {
			useDefaults: true,
			directives: {
				defaultSrc: ["'self'"],
				scriptSrc: ["'self'"],
				styleSrc: ["'self'"],
				imgSrc: ["'self'", 'data:'],
				formAction: ["'self'"],
				frameAncestors: ["'none'"],
				objectSrc: ["'none'"],
				baseUri: ["'self'"],
				// panel may be reached over plain HTTP on 127.0.0.1; HTTPS is the proxy's job
				upgradeInsecureRequests: null,
			},
		},
		referrerPolicy: { policy: 'no-referrer' },
	}));

	app.use('/static', express.static(path.join(__dirname, 'public'), { maxAge: '1h', index: false }));

	// Nothing below may be cached by the browser or a proxy
	app.use((req, res, next) => {
		res.set('Cache-Control', 'no-store');
		next();
	});

	app.use(express.urlencoded({ extended: true, limit: '20kb', parameterLimit: 100 }));

	app.use(session({
		name: SESSION_COOKIE,
		store: new PgStore({ pool, tableName: 'admin_sessions', createTableIfMissing: false, pruneSessionInterval: 15 * 60 }),
		secret: config.sessionSecret,
		resave: false,
		saveUninitialized: false,
		rolling: true,
		cookie: {
			httpOnly: true,
			sameSite: 'strict',
			secure: config.cookieSecure,
			maxAge: config.sessionTtlMs,
		},
	}));

	const fmt = createFormatters(config.timezone);
	app.use((req, res, next) => {
		res.locals.fmt = fmt;
		res.locals.admin = req.session.admin ?? null;
		res.locals.csrfToken = req.session.csrfToken ?? '';
		res.locals.currentPath = req.path;
		res.locals.flash = req.session.flash ?? null;
		if (req.session.flash) delete req.session.flash;
		next();
	});

	app.use(authRouter({ pool, config }));

	// Everything after this line requires a logged-in admin and a CSRF token
	app.use(requireAuth);
	app.use(requireCsrf);

	app.use(dashboardRouter({ pool, config }));
	app.use(usersRouter({ pool, config }));
	app.use(plansRouter({ pool, config }));
	app.use(auditRouter({ pool, config }));

	app.use((req, res) => {
		res.status(404).render('error', { status: 404, message: 'Сторінку не знайдено' });
	});

	// eslint-disable-next-line no-unused-vars
	app.use((err, req, res, next) => {
		log(`[admin] error on ${req.method} ${req.path}: ${err.message}`);
		if (res.headersSent) return;
		res.status(500).render('error', { status: 500, message: 'Внутрішня помилка' });
	});

	return app;
}
