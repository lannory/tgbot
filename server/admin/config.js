const BCRYPT_HASH_RE = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

// Reads and validates admin panel settings. Throws with every problem listed
// so a misconfigured panel never starts half-secured.
export function loadConfig(env = process.env) {
	const errors = [];

	const user = env.ADMIN_PANEL_USER?.trim();
	const passwordHash = env.ADMIN_PANEL_PASSWORD_HASH?.trim();
	const sessionSecret = env.ADMIN_PANEL_SESSION_SECRET;

	if (!user) errors.push('ADMIN_PANEL_USER is not set');
	if (!passwordHash || !BCRYPT_HASH_RE.test(passwordHash)) {
		errors.push('ADMIN_PANEL_PASSWORD_HASH must be a bcrypt hash (generate it with `npm run admin:hash-password`)');
	}
	if (!sessionSecret || sessionSecret.length < 32) {
		errors.push('ADMIN_PANEL_SESSION_SECRET must be at least 32 characters');
	}

	const cookieSecure = env.ADMIN_PANEL_COOKIE_SECURE ?? 'auto';
	if (!['true', 'false', 'auto'].includes(cookieSecure)) {
		errors.push('ADMIN_PANEL_COOKIE_SECURE must be true, false or auto');
	}

	if (errors.length > 0) {
		throw new Error(`Admin panel is not configured:\n - ${errors.join('\n - ')}`);
	}

	return {
		user,
		passwordHash,
		sessionSecret,
		host: env.ADMIN_PANEL_HOST || '127.0.0.1',
		port: Number(env.ADMIN_PANEL_PORT) || 3100,
		// 'auto' = Secure flag whenever the request came over HTTPS (directly or
		// via a trusted reverse proxy sending X-Forwarded-Proto: https)
		cookieSecure: cookieSecure === 'auto' ? 'auto' : cookieSecure === 'true',
		trustProxy: env.ADMIN_PANEL_TRUST_PROXY || 'loopback',
		timezone: env.STATS_TIMEZONE || 'Europe/Kyiv',
		sessionTtlMs: (Number(env.ADMIN_PANEL_SESSION_HOURS) || 8) * 60 * 60_000,
		loginRateLimit: {
			windowMs: 15 * 60_000,
			limit: Number(env.ADMIN_PANEL_LOGIN_MAX_ATTEMPTS) || 10,
		},
	};
}
