import { listActiveSearches, hasSeen, markSeen, enqueueNotification } from './db.js';
import { searchEbay } from './ebay.js';

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS) || 90_000;
const REQUEST_DELAY_MS = 400;

let busy = false;

function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollSearch(search) {
	let items;
	try {
		items = await searchEbay(search);
	} catch (err) {
		console.log(`poll failed for search ${search.id} ("${search.query}")`, err.message);
		return;
	}

	for (const item of items) {
		const alreadySeen = await hasSeen(search.id, item.itemId);
		if (alreadySeen) continue;

		await markSeen(search.id, item.itemId);
		await enqueueNotification(search.chat_id, search.id, item);
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
