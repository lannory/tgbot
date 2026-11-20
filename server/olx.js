import axios from 'axios';

const OLX_API = 'https://www.olx.ua/api/v1/offers/';

const HEADERS = {
	Accept: 'application/json, text/plain, */*',
	'Accept-Language': 'uk-UA,uk;q=0.9,en-US;q=0.8,en;q=0.7',
	'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
	Referer: 'https://www.olx.ua/',
};

// OLX sits behind a CloudFront WAF that answers 403 to clients it flags as
// bots, and the block is per IP — polling on while blocked only prolongs it,
// so every OLX search pauses together with exponential backoff
const MIN_BACKOFF_MS = 2 * 60_000;
const MAX_BACKOFF_MS = 30 * 60_000;
let backoffMs = 0;
let blockedUntil = 0;

export class OlxBackoffError extends Error {}

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
		// promoted ads take a share of each page, and listings surfacing late
		// after moderation sort below newer ones — a wide page keeps them in view
		limit: '40',
		query: search.query,
		// the param the OLX site itself uses; promoted ads still get mixed in,
		// so the poller additionally filters by item creation date
		'search[order]': 'created_at:desc',
	});

	if (search.min_price != null) params.set('filter_float_price:from', String(search.min_price));
	if (search.max_price != null) params.set('filter_float_price:to', String(search.max_price));
	if (search.condition === 'NEW') params.set('filter_enum_state[0]', 'new');
	if (search.condition === 'USED') params.set('filter_enum_state[0]', 'used');

	let response;
	try {
		response = await axios.get(`${OLX_API}?${params.toString()}`, { headers: HEADERS });
	} catch (err) {
		const status = err.response?.status;
		if (status === 403 || status === 429) throw registerBlock(`HTTP ${status}`);
		throw err;
	}

	// a WAF challenge page can also come back as 200 with HTML instead of JSON
	if (typeof response.data !== 'object' || !Array.isArray(response.data.data)) {
		throw registerBlock('non-JSON response');
	}

	if (backoffMs > 0) {
		console.log('[olx] OLX responds again, backoff cleared');
		backoffMs = 0;
	}

	return response.data.data.map(normalizeItem);
}
