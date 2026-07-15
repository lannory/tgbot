import { listActiveSearches, hasSeen, markSeen, enqueueNotification, advanceLastItemCreatedAt } from './db.js';
import { searchEbay } from './ebay.js';
import { searchOlx } from './olx.js';

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS) || 90_000;
const REQUEST_DELAY_MS = 400;

let busy = false;

function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollSearch(search) {
	let items;
	try {
		items = search.source === 'olx' ? await searchOlx(search) : await searchEbay(search);
	} catch (err) {
		console.log(`poll failed for search ${search.id} ("${search.query}")`, err.message);
		return;
	}

	// high watermark: the creation date of the newest listing already notified
	// (starts at search creation time), so old promoted listings rotated into
	// the results months later never count as "new"
	const watermark = new Date(search.last_item_created_at ?? search.created_at);
	let newWatermark = watermark;

	// oldest first, so Telegram messages arrive in chronological order
	items.sort((a, b) => new Date(a.itemCreationDate) - new Date(b.itemCreationDate));

	for (const item of items) {
		const alreadySeen = await hasSeen(search.id, item.itemId);
		if (alreadySeen) continue;

		await markSeen(search.id, item.itemId);

		const itemCreatedAt = new Date(item.itemCreationDate);
		if (Number.isNaN(itemCreatedAt.getTime()) || itemCreatedAt <= watermark) continue;

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
		const searches = await listActiveSearches();
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
