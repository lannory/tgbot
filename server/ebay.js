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
