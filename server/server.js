import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import cors from 'cors';

import { ensureSchema, createSearch, countSearchesByChat, listSearchesByChat, setActive, deleteSearch, popAllNotifications, createSnipe, listSnipesByChat, cancelSnipe } from './db.js';
import { ensureToken, getCategorySuggestions, getItemDetails } from './ebay.js';
import { getConsentUrl, exchangeCode, isLinked } from './ebay-auth.js';
import { startPoller } from './poller.js';
import { startSniper } from './sniper.js';
import { startMaintenance } from './maintenance.js';
import { ensureUser, isAdminBlocked } from './users.js';
import { botUsersRouter } from './routes/botUsers.js';

const app = express();
const PORT = Number(process.env.PORT) || 3000;

const MAX_SEARCHES_PER_CHAT = Number(process.env.MAX_SEARCHES_PER_CHAT) || 5;
const CONDITIONS = ['NEW', 'USED'];
const BUYING_OPTIONS = ['AUCTION', 'FIXED_PRICE'];
const SOURCES = ['ebay', 'olx'];

app.use(cors());

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

	const count = await countSearchesByChat(String(chatId));
	if (count >= MAX_SEARCHES_PER_CHAT) {
		return res.status(400).json({ error: `Max ${MAX_SEARCHES_PER_CHAT} searches per chat` });
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

// --- bid sniper (owner-only v1) ---

const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;

function requireAdmin(chatId, res) {
	if (!ADMIN_CHAT_ID || String(chatId) !== ADMIN_CHAT_ID) {
		res.status(403).json({ error: 'Sniper is not available for this chat' });
		return false;
	}
	return true;
}

app.get('/auth/ebay/url', async (req, res) => {
	const { chatId } = req.query;
	if (!requireAdmin(chatId, res)) return;

	res.json({ url: getConsentUrl(), linked: await isLinked(String(chatId)) });
});

app.post('/auth/ebay/code', async (req, res) => {
	const { chatId, code } = req.body;
	if (!requireAdmin(chatId, res)) return;

	if (!code || typeof code !== 'string') {
		return res.status(400).json({ error: 'code is required' });
	}

	try {
		await exchangeCode(String(chatId), decodeURIComponent(code.trim()));
		res.json({ linked: true });
	} catch (err) {
		const detail = err.response?.data?.error_description || err.message;
		res.status(400).json({ error: `Failed to link eBay account: ${detail}` });
	}
});

app.post('/snipes', async (req, res) => {
	const { chatId, itemId, maxBid } = req.body;
	if (!requireAdmin(chatId, res)) return;

	if (!itemId || typeof maxBid !== 'number' || Number.isNaN(maxBid) || maxBid <= 0) {
		return res.status(400).json({ error: 'itemId and a positive maxBid are required' });
	}

	if (!(await isLinked(String(chatId)))) {
		return res.status(400).json({ error: 'eBay account is not linked' });
	}

	let item;
	try {
		item = await getItemDetails(String(itemId));
	} catch (err) {
		return res.status(400).json({ error: 'Item not found on eBay' });
	}

	if (!item.buyingOptions.includes('AUCTION')) {
		return res.status(400).json({ error: 'Item is not an auction' });
	}
	if (!item.endTime || new Date(item.endTime) <= new Date()) {
		return res.status(400).json({ error: 'Auction has already ended' });
	}

	const currentBid = item.currentBidPrice?.value != null ? Number(item.currentBidPrice.value) : null;
	if (currentBid != null && maxBid <= currentBid) {
		return res.status(400).json({ error: `Max bid must exceed the current bid (${currentBid} ${item.currentBidPrice.currency})` });
	}

	const snipe = await createSnipe(String(chatId), {
		itemId: item.itemId,
		legacyItemId: item.legacyItemId,
		title: item.title,
		endTime: item.endTime,
		maxBid,
		currency: item.currentBidPrice?.currency ?? 'USD',
	});

	res.status(201).json(snipe);
});

app.get('/snipes', async (req, res) => {
	const { chatId } = req.query;
	if (!requireAdmin(chatId, res)) return;

	res.json(await listSnipesByChat(String(chatId)));
});

app.delete('/snipes/:id', async (req, res) => {
	const { chatId } = req.query;
	if (!requireAdmin(chatId, res)) return;

	if (!Number.isInteger(Number(req.params.id))) {
		return res.status(400).json({ error: 'invalid snipe id' });
	}

	const snipe = await cancelSnipe(req.params.id, String(chatId));
	if (!snipe) {
		return res.status(404).json({ error: 'Pending snipe not found' });
	}

	res.json(snipe);
});

app.listen(PORT, async () => {
	console.log('server started, port ' + PORT);
	await ensureSchema();
	startMaintenance();
	await ensureToken();
	startPoller();
	startSniper();
});
