import axios from 'axios';

const OLX_API = 'https://www.olx.ua/api/v1/offers/';

const HEADERS = {
	Accept: 'application/json, text/plain, */*',
	'Accept-Language': 'uk-UA,uk;q=0.9,en-US;q=0.8,en;q=0.7',
	'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
	Referer: 'https://www.olx.ua/',
};

// OLX sits behind a CloudFront WAF. Most of its 403s are one-off rejections
// (measured: a retry 20 s later passes ~7 times in 8), so a rejected request
// is retried once; only a run of rejections counts as a real per-IP block,
// and then every OLX search pauses together with exponential backoff
const RETRY_DELAY_MS = 20_000;
const BLOCK_AFTER_FAILURES = 3;
const MIN_BACKOFF_MS = 2 * 60_000;
const MAX_BACKOFF_MS = 30 * 60_000;
let consecutiveFailures = 0;
let backoffMs = 0;
let blockedUntil = 0;

export class OlxBackoffError extends Error {}

// OLX caches the results of each distinct request for ~6 minutes, so an
// identical poll keeps getting the same stale page while new listings are
// already visible to other requests. Each search cycles its page size, so
// a request repeats only after 11 polls — far longer than the cache lives.
const PAGE_SIZES = [40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50];
const pollCounts = new Map();

function nextPageSize(searchId) {
	const count = pollCounts.get(searchId) ?? 0;
	pollCounts.set(searchId, count + 1);
	return PAGE_SIZES[count % PAGE_SIZES.length];
}

function registerBlock(reason) {
	backoffMs = Math.min(Math.max(backoffMs * 2, MIN_BACKOFF_MS), MAX_BACKOFF_MS);
	blockedUntil = Date.now() + backoffMs;
	console.log(`[olx] blocked by OLX (${reason}), pausing OLX polling for ${Math.round(backoffMs / 60_000)} min`);
	return new OlxBackoffError(`OLX blocked (${reason})`);
}

// OLX is an undocumented endpoint used by their own frontend — no auth,
// but item shape differs from eBay, so results are normalized to the
// payload fields the bot's formatItem expects (plus source: 'olx').
function normalizeItem(offer) {
	const priceParam = offer.params?.find((p) => p.key === 'price');
	const stateParam = offer.params?.find((p) => p.key === 'state');

	return {
		source: 'olx',
		itemId: `olx:${offer.id}`,
		title: offer.title,
		price: {
			value: priceParam?.value?.value ?? null,
			currency: priceParam?.value?.currency ?? 'UAH',
			label: priceParam?.value?.label ?? null,
		},
		condition: stateParam?.value?.label ?? null,
		itemWebUrl: offer.url,
		itemCreationDate: offer.created_time,
		location: offer.location?.city?.name ?? null,
	};
}

export async function searchOlx(search) {
	if (Date.now() < blockedUntil) {
		throw new OlxBackoffError('OLX polling paused (backoff)');
	}

	const params = new URLSearchParams({
		offset: '0',
		// busy queries get many refreshes a minute — a wide page keeps a few
		// minutes of activity in view between polls
		limit: String(nextPageSize(search.id)),
		query: search.query,
		// OLX's "newest" order: by last refresh time (activation after moderation,
		// or a seller bumping an old ad), not creation time. The API ignores the
		// website's search[order] param and falls back to relevance. Bumped old
		// ads are filtered out by the poller using the creation date.
		sort_by: 'created_at:desc',
	});

	if (search.min_price != null) params.set('filter_float_price:from', String(search.min_price));
	if (search.max_price != null) params.set('filter_float_price:to', String(search.max_price));
	if (search.condition === 'NEW') params.set('filter_enum_state[0]', 'new');
	if (search.condition === 'USED') params.set('filter_enum_state[0]', 'used');

	const url = `${OLX_API}?${params.toString()}`;

	let result = await requestOffers(url);
	if (result.rejected) {
		await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
		result = await requestOffers(url);
	}

	if (result.rejected) {
		consecutiveFailures++;
		if (consecutiveFailures >= BLOCK_AFTER_FAILURES) throw registerBlock(result.rejected);
		console.log(`[olx] request rejected twice (${result.rejected}), retrying next cycle`);
		throw new OlxBackoffError(`OLX rejected request (${result.rejected})`);
	}

	if (backoffMs > 0) console.log('[olx] OLX responds again, backoff cleared');
	consecutiveFailures = 0;
	backoffMs = 0;

	return result.offers.map(normalizeItem);
}

async function requestOffers(url) {
	let response;
	try {
		response = await axios.get(url, { headers: HEADERS });
	} catch (err) {
		const status = err.response?.status;
		if (status === 403 || status === 429) return { rejected: `HTTP ${status}` };
		throw err;
	}

	// a WAF challenge page can also come back as 200 with HTML instead of JSON
	if (typeof response.data !== 'object' || !Array.isArray(response.data.data)) {
		return { rejected: 'non-JSON response' };
	}

	return { offers: response.data.data };
}
