// Admin panel entry point: `npm run admin` (from server/)
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const { loadConfig } = await import('./config.js');
const { pool, ensureSchema } = await import('../db.js');
const { createApp } = await import('./app.js');

let config;
try {
	config = loadConfig();
} catch (err) {
	console.error(err.message);
	process.exit(1);
}

await ensureSchema();

const app = createApp({ pool, config });
const server = app.listen(config.port, config.host, () => {
	console.log(`[admin] panel listening on http://${config.host}:${config.port}`);
	if (!['127.0.0.1', 'localhost', '::1'].includes(config.host)) {
		console.log('[admin] WARNING: listening on a non-loopback address; put it behind an HTTPS reverse proxy');
	}
	if (config.cookieSecure === false) {
		console.log('[admin] WARNING: ADMIN_PANEL_COOKIE_SECURE=false, session cookie is sent over plain HTTP');
	}
});

function shutdown() {
	server.close(() => pool.end().finally(() => process.exit(0)));
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
