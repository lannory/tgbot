import {
	listDueSnipes,
	listMissedSnipes,
	listPlacedAwaitingResult,
	updateSnipeStatus,
	enqueueNotification,
} from './db.js';
import { placeBid, getWonItemIds } from './ebay.js';
import { getUserAccessToken } from './ebay-auth.js';

const TICK_MS = 5000;
const SNIPE_LEAD_SECONDS = Number(process.env.SNIPE_LEAD_SECONDS) || 10;
const DRY_RUN = process.env.SNIPE_DRY_RUN === '1';

let busy = false;

function snipePayload(snipe, event, extra = {}) {
	return {
		type: 'snipe_update',
		event,
		snipeId: snipe.id,
		title: snipe.title,
		legacyItemId: snipe.legacy_item_id,
		maxBid: snipe.max_bid,
		currency: snipe.currency,
		...extra,
	};
}

async function placeDueBids() {
	const due = await listDueSnipes(SNIPE_LEAD_SECONDS);

	for (const snipe of due) {
		try {
			if (DRY_RUN) {
				console.log(`[sniper] DRY RUN: would bid ${snipe.max_bid} ${snipe.currency} on ${snipe.legacy_item_id} ("${snipe.title}")`);
				await updateSnipeStatus(snipe.id, 'placed', { placedAt: new Date() });
			} else {
				const accessToken = await getUserAccessToken(snipe.chat_id);
				const result = await placeBid({
					legacyItemId: snipe.legacy_item_id,
					maxBid: snipe.max_bid,
					currency: snipe.currency,
					accessToken,
				});
				console.log(`[sniper] bid placed on ${snipe.legacy_item_id}:`, result);
				await updateSnipeStatus(snipe.id, 'placed', { placedAt: new Date() });
			}

			await enqueueNotification(snipe.chat_id, null, snipePayload(snipe, 'placed', { dryRun: DRY_RUN }));
		} catch (err) {
			console.log(`[sniper] bid failed for snipe ${snipe.id}:`, err.message);
			await updateSnipeStatus(snipe.id, 'failed', { error: err.message });
			await enqueueNotification(snipe.chat_id, null, snipePayload(snipe, 'failed', { error: err.message }));
		}
	}
}

async function failMissedSnipes() {
	const missed = await listMissedSnipes();

	for (const snipe of missed) {
		await updateSnipeStatus(snipe.id, 'failed', { error: 'missed: auction ended before a bid could be placed' });
		await enqueueNotification(snipe.chat_id, null, snipePayload(snipe, 'missed'));
	}
}

async function checkResults() {
	const awaiting = await listPlacedAwaitingResult();
	if (awaiting.length === 0) return;

	const byChat = new Map();
	for (const snipe of awaiting) {
		if (!byChat.has(snipe.chat_id)) byChat.set(snipe.chat_id, []);
		byChat.get(snipe.chat_id).push(snipe);
	}

	for (const [chatId, snipes] of byChat) {
		let wonIds;
		try {
			const accessToken = await getUserAccessToken(chatId);
			wonIds = await getWonItemIds(accessToken);
		} catch (err) {
			console.log(`[sniper] result check failed for chat ${chatId}:`, err.message);
			continue;
		}

		for (const snipe of snipes) {
			const won = wonIds.includes(String(snipe.legacy_item_id));
			await updateSnipeStatus(snipe.id, won ? 'won' : 'lost');
			await enqueueNotification(chatId, null, snipePayload(snipe, won ? 'won' : 'lost'));
		}
	}
}

async function runSniperTick() {
	if (busy) return;
	busy = true;

	try {
		await placeDueBids();
		await failMissedSnipes();
		await checkResults();
	} catch (err) {
		console.log('[sniper] tick failed', err.message);
	} finally {
		busy = false;
	}
}

export function startSniper() {
	console.log(`[sniper] started (lead: ${SNIPE_LEAD_SECONDS}s, dry run: ${DRY_RUN})`);
	setInterval(runSniperTick, TICK_MS);
}
