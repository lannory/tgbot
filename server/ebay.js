import axios from 'axios';

const clientId = process.env.EBAY_CLIENT_ID;
const clientSecret = process.env.EBAY_CLIENT_SECRET;

let token = null;
let tokenExpiresAt = 0;

async function fetchToken() {
	const base64Credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

	const response = await axios.post(
		'https://api.ebay.com/identity/v1/oauth2/token',
		new URLSearchParams({
			grant_type: 'client_credentials',
			scope: 'https://api.ebay.com/oauth/api_scope',
		}),
		{
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				Authorization: `Basic ${base64Credentials}`,
			},
		}
	);

	token = response.data.access_token;
	tokenExpiresAt = Date.now() + response.data.expires_in * 1000;
}

export async function ensureToken() {
	if (!token || Date.now() >= tokenExpiresAt - 60_000) {
		await fetchToken();
	}
	return token;
}

function buildFilter(search) {
	const parts = [];

	if (search.min_price != null || search.max_price != null) {
		const min = search.min_price != null ? search.min_price : '';
		const max = search.max_price != null ? search.max_price : '';
		parts.push(`price:[${min}..${max}]`);
		parts.push('priceCurrency:USD');
	}
	if (search.condition) {
		parts.push(`conditions:{${search.condition}}`);
	}
	if (search.buying_option) {
		parts.push(`buyingOptions:{${search.buying_option}}`);
	}
	if (search.us_only) {
		parts.push('itemLocationCountry:US');
	}

	return parts.join(',');
}

export async function searchEbay(search) {
	await ensureToken();

	const params = {
		q: search.query,
		limit: 10,
		sort: 'newlyListed',
	};

	if (search.category_id) {
		params.category_ids = search.category_id;
	}

	const filter = buildFilter(search);
	if (filter) {
		params.filter = filter;
	}

	const response = await axios.get('https://api.ebay.com/buy/browse/v1/item_summary/search', {
		params,
		headers: {
			'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
			Authorization: `Bearer ${token}`,
		},
	});

	return response.data.itemSummaries ?? [];
}

export async function getItemDetails(itemId) {
	await ensureToken();

	const isLegacyId = /^\d+$/.test(String(itemId));
	const url = isLegacyId
		? `https://api.ebay.com/buy/browse/v1/item/get_item_by_legacy_id?legacy_item_id=${itemId}`
		: `https://api.ebay.com/buy/browse/v1/item/${encodeURIComponent(itemId)}`;

	const response = await axios.get(url, {
		headers: {
			'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
			Authorization: `Bearer ${token}`,
		},
	});

	const item = response.data;
	return {
		itemId: item.itemId,
		legacyItemId: item.legacyItemId,
		title: item.title,
		endTime: item.itemEndDate ?? null,
		buyingOptions: item.buyingOptions ?? [],
		currentBidPrice: item.currentBidPrice ?? item.price ?? null,
		itemWebUrl: item.itemWebUrl,
	};
}

function xmlEscape(value) {
	return String(value).replace(/[<>&'"]/g, (c) => ({
		'<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;',
	}[c]));
}

let cachedPublicIp = null;

// Trading API's PlaceOffer requires the end user's IP for fraud checks.
// Since the "user" here is this server acting on the owner's behalf
// (not a browser request), use the server's own public IP, cached for
// the process lifetime. Override with EBAY_END_USER_IP if set.
async function getEndUserIp() {
	if (process.env.EBAY_END_USER_IP) return process.env.EBAY_END_USER_IP;
	if (cachedPublicIp) return cachedPublicIp;

	const response = await axios.get('https://api.ipify.org?format=json');
	cachedPublicIp = response.data.ip;
	return cachedPublicIp;
}

export async function placeBid({ legacyItemId, maxBid, currency, accessToken }) {
	const endUserIp = await getEndUserIp();

	const body = `<?xml version="1.0" encoding="utf-8"?>
<PlaceOfferRequest xmlns="urn:ebay:apis:eBLBaseComponents">
	<EndUserIP>${xmlEscape(endUserIp)}</EndUserIP>
	<ItemID>${xmlEscape(legacyItemId)}</ItemID>
	<Offer>
		<Action>Bid</Action>
		<MaxBid currencyID="${xmlEscape(currency)}">${xmlEscape(maxBid)}</MaxBid>
		<Quantity>1</Quantity>
	</Offer>
	<ErrorLanguage>en_US</ErrorLanguage>
</PlaceOfferRequest>`;

	const response = await axios.post('https://api.ebay.com/ws/api.dll', body, {
		headers: {
			'Content-Type': 'text/xml',
			'X-EBAY-API-CALL-NAME': 'PlaceOffer',
			'X-EBAY-API-COMPATIBILITY-LEVEL': '1119',
			'X-EBAY-API-SITEID': '0',
			'X-EBAY-API-IAF-TOKEN': accessToken,
		},
	});

	const xml = response.data;
	const ack = xml.match(/<Ack>([^<]+)<\/Ack>/)?.[1];

	if (ack !== 'Success' && ack !== 'Warning') {
		const errors = [...xml.matchAll(/<LongMessage>([^<]+)<\/LongMessage>/g)]
			.map((m) => m[1])
			.join('; ');
		throw new Error(errors || `PlaceOffer failed (Ack: ${ack ?? 'unknown'})`);
	}

	return {
		ack,
		sellingState: xml.match(/<SellingState>([^<]+)<\/SellingState>/)?.[1] ?? null,
		currentPrice: xml.match(/<CurrentPrice[^>]*>([^<]+)<\/CurrentPrice>/)?.[1] ?? null,
	};
}

export async function getWonItemIds(accessToken) {
	const body = `<?xml version="1.0" encoding="utf-8"?>
<GetMyeBayBuyingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
	<WonList>
		<Include>true</Include>
		<DurationInDays>2</DurationInDays>
	</WonList>
</GetMyeBayBuyingRequest>`;

	const response = await axios.post('https://api.ebay.com/ws/api.dll', body, {
		headers: {
			'Content-Type': 'text/xml',
			'X-EBAY-API-CALL-NAME': 'GetMyeBayBuying',
			'X-EBAY-API-COMPATIBILITY-LEVEL': '1119',
			'X-EBAY-API-SITEID': '0',
			'X-EBAY-API-IAF-TOKEN': accessToken,
		},
	});

	return [...String(response.data).matchAll(/<ItemID>(\d+)<\/ItemID>/g)].map((m) => m[1]);
}

export async function getCategorySuggestions(query) {
	await ensureToken();

	const response = await axios.get(
		'https://api.ebay.com/commerce/taxonomy/v1/category_tree/0/get_category_suggestions',
		{
			params: { q: query },
			headers: { Authorization: `Bearer ${token}` },
		}
	);

	const suggestions = response.data.categorySuggestions ?? [];
	return suggestions.map((s) => ({
		categoryId: s.category.categoryId,
		categoryName: s.category.categoryName,
		parentName: s.categoryTreeNodeAncestors?.[0]?.categoryName ?? null,
	}));
}
