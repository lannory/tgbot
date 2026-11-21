import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import cors from 'cors';

import { ensureSchema, createSearch, listSearchesByChat, setActive, deleteSearch, popAllNotifications } from './db.js';
import { ensureToken, getCategorySuggestions } from './ebay.js';
import { startPoller } from './poller.js';
import { startMaintenance } from './maintenance.js';
import { ensureUser, isAdminBlocked } from './users.js';
import { canCreateSearch } from './billing/entitlements.js';
import { createProviders } from './billing/providers/index.js';
import { botUsersRouter } from './routes/botUsers.js';
import { billingRouter, webhooksRouter } from './routes/billing.js';

const app = express();
const PORT = Number(process.env.PORT) || 3000;

const CONDITIONS = ['NEW', 'USED'];
const BUYING_OPTIONS = ['AUCTION', 'FIXED_PRICE'];
const SOURCES = ['ebay', 'olx'];

const paymentProviders = createProviders();

app.use(cors());

// Payment webhooks verify their own signatures on the raw body, so they are
// mounted before the JSON parser and outside the bot API token check
app.use(webhooksRouter({ providers: paymentProviders }));

// Optional shared secret between the bot and this API. When unset, the API
// behaves as before (no auth) for backward compatibility.
const BACKEND_API_TOKEN = process.env.BACKEND_API_TOKEN;
if (BACKEND_API_TOKEN) {
	const expected = Buffer.from(BACKEND_API_TOKEN);
	app.use((req, res, next) => {
		const given = Buffer.from(String(req.get('x-api-token') ?? ''));
		if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
			return res.status(401).json({ error: 'unauthorized' });
		}
		next();
	});
}

app.use(express.json());
app.use(botUsersRouter());
app.use(billingRouter({ providers: paymentProviders }));

function parseSearchFilters(body) {
	const { source, categoryId, minPrice, maxPrice, condition, buyingOption, usOnly } = body;

	if (source != null && !SOURCES.includes(source)) {
		return { error: `source must be one of ${SOURCES.join(', ')}` };
	}
	if (categoryId != null && typeof categoryId !== 'string' && typeof categoryId !== 'number') {
		return { error: 'categoryId must be a string or number' };
	}
	if (minPrice != null && (typeof minPrice !== 'number' || Number.isNaN(minPrice))) {
		return { error: 'minPrice must be a number' };
	}
	if (maxPrice != null && (typeof maxPrice !== 'number' || Number.isNaN(maxPrice))) {
		return { error: 'maxPrice must be a number' };
	}
	if (minPrice != null && maxPrice != null && minPrice > maxPrice) {
		return { error: 'minPrice must not be greater than maxPrice' };
	}
	if (condition != null && !CONDITIONS.includes(condition)) {
		return { error: `condition must be one of ${CONDITIONS.join(', ')}` };
	}
	if (buyingOption != null && !BUYING_OPTIONS.includes(buyingOption)) {
		return { error: `buyingOption must be one of ${BUYING_OPTIONS.join(', ')}` };
	}
	if (usOnly != null && typeof usOnly !== 'boolean') {
		return { error: 'usOnly must be a boolean' };
	}

	return {
		filters: {
			source: source ?? 'ebay',
			categoryId: categoryId != null ? String(categoryId) : null,
			minPrice: minPrice ?? null,
			maxPrice: maxPrice ?? null,
			condition: condition ?? null,
			buyingOption: buyingOption ?? null,
			usOnly: usOnly ?? false,
		},
	};
}

app.post('/searches', async (req, res) => {
	const { chatId, query } = req.body;

	if (!chatId || typeof query !== 'string' || !query.trim()) {
		return res.status(400).json({ error: 'chatId and query are required' });
	}

	const { filters, error } = parseSearchFilters(req.body);
	if (error) {
		return res.status(400).json({ error });
	}

	if (await isAdminBlocked(String(chatId))) {
		return res.status(403).json({ error: 'Access to the bot is restricted' });
	}

	const allowed = await canCreateSearch(String(chatId), filters.source);
	if (!allowed.ok) {
		return res.status(400).json({ error: allowed.error, code: allowed.code });
	}

	await ensureUser(String(chatId));
	const search = await createSearch(String(chatId), { query: query.trim(), ...filters });
	res.status(201).json(search);
});

app.get('/searches', async (req, res) => {
	const { chatId } = req.query;

	if (!chatId) {
		return res.status(400).json({ error: 'chatId is required' });
	}

	const searches = await listSearchesByChat(String(chatId));
	res.json(searches);
});

app.patch('/searches/:id', async (req, res) => {
	const { chatId, active } = req.body;

	if (!chatId || typeof active !== 'boolean' || !Number.isInteger(Number(req.params.id))) {
		return res.status(400).json({ error: 'chatId and active are required' });
	}

	const search = await setActive(req.params.id, String(chatId), active);
	if (!search) {
		return res.status(404).json({ error: 'Search not found' });
	}

	res.json(search);
});

app.delete('/searches/:id', async (req, res) => {
	const { chatId } = req.query;

	if (!chatId || !Number.isInteger(Number(req.params.id))) {
		return res.status(400).json({ error: 'chatId is required' });
	}

	const search = await deleteSearch(req.params.id, String(chatId));
	if (!search) {
		return res.status(404).json({ error: 'Search not found' });
	}

	res.json(search);
});

app.get('/categories/suggest', async (req, res) => {
	const { q } = req.query;

	if (!q || typeof q !== 'string') {
		return res.status(400).json({ error: 'q is required' });
	}

	try {
		const suggestions = await getCategorySuggestions(q);
		res.json(suggestions.slice(0, 6));
	} catch (err) {
		res.status(502).json({ error: 'Failed to fetch category suggestions' });
	}
});

app.get('/notifications/all', async (req, res) => {
	const groups = await popAllNotifications();
	res.json(groups);
});

app.listen(PORT, async () => {
	console.log('server started, port ' + PORT);
	await ensureSchema();
	startMaintenance();
	await ensureToken();
	startPoller();
});
