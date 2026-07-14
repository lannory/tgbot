import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import { init, createSearch, countSearchesByChat, listSearchesByChat, setActive, deleteSearch, popAllNotifications } from './db.js';
import { ensureToken, getCategorySuggestions } from './ebay.js';
import { startPoller } from './poller.js';

const app = express();
const PORT = 3000;

const MAX_SEARCHES_PER_CHAT = Number(process.env.MAX_SEARCHES_PER_CHAT) || 5;
const CONDITIONS = ['NEW', 'USED'];
const BUYING_OPTIONS = ['AUCTION', 'FIXED_PRICE'];

app.use(cors());
app.use(express.json());

function parseSearchFilters(body) {
	const { categoryId, minPrice, maxPrice, condition, buyingOption, usOnly } = body;

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

	const count = await countSearchesByChat(String(chatId));
	if (count >= MAX_SEARCHES_PER_CHAT) {
		return res.status(400).json({ error: `Max ${MAX_SEARCHES_PER_CHAT} searches per chat` });
	}

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
	await init();
	await ensureToken();
	startPoller();
});
