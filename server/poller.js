import { listPollableSearches, hasSeen, markSeen, enqueueNotification, advanceLastItemCreatedAt } from './db.js';
import { searchEbay } from './ebay.js';
import { searchOlx, OlxBackoffError } from './olx.js';

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS) || 90_000;
const REQUEST_DELAY_MS = 400;

// OLX lists an ad in search only after moderation, which can take an hour or
// more, so a listing may surface after newer ones were already notified
const MODERATION_GRACE_MS = 3 * 60 * 60_000;

// Unseen listings created after this moment are notified. The watermark (the
// creation date of the newest notified listing) keeps months-old promoted ads
// out; the grace window lets late-moderated listings through; and nothing
// older than the search itself counts, so a new search doesn't flood the chat.
export function notifyThreshold(search) {
	const createdAt = new Date(search.created_at).getTime();
	const watermark = new Date(search.last_item_created_at ?? search.created_at).getTime();
	return new Date(Math.max(createdAt, watermark - MODERATION_GRACE_MS));
}

let busy = false;

function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollSearch(search) {
	let items;
	try {
		items = search.source === 'olx' ? await searchOlx(search) : await searchEbay(search);
	} catch (err) {
		// backoff is already logged once by olx.js, not on every skipped cycle
		if (!(err instanceof OlxBackoffError)) {
			console.log(`poll failed for search ${search.id} ("${search.query}")`, err.message);
		}
		return;
	}

	const watermark = new Date(search.last_item_created_at ?? search.created_at);
	const threshold = notifyThreshold(search);
	let newWatermark = watermark;

	// oldest first, so Telegram messages arrive in chronological order
	items.sort((a, b) => new Date(a.itemCreationDate) - new Date(b.itemCreationDate));

	for (const item of items) {
		const alreadySeen = await hasSeen(search.id, item.itemId);
		if (alreadySeen) continue;

		await markSeen(search.id, item.itemId);

		const itemCreatedAt = new Date(item.itemCreationDate);
		if (Number.isNaN(itemCreatedAt.getTime()) || itemCreatedAt <= threshold) continue;

		await enqueueNotification(search.chat_id, search.id, item);
		if (itemCreatedAt > newWatermark) newWatermark = itemCreatedAt;
	}

	if (newWatermark > watermark) {
		await advanceLastItemCreatedAt(search.id, newWatermark);
	}
}

async function runPollCycle() {
	if (busy) return;
	busy = true;

	try {
		const searches = await listPollableSearches();
		for (const search of searches) {
			await pollSearch(search);
			await delay(REQUEST_DELAY_MS);
		}
	} catch (err) {
		console.log('poll cycle failed', err.message);
	} finally {
		busy = false;
	}
}

export function startPoller() {
	runPollCycle();
	setInterval(runPollCycle, POLL_INTERVAL_MS);
}
