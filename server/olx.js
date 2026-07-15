import axios from 'axios';

const OLX_API = 'https://www.olx.ua/api/v1/offers/';

const HEADERS = {
	Accept: 'application/json',
	'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
};

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
	const params = new URLSearchParams({
		offset: '0',
		limit: '10',
		query: search.query,
		// the param the OLX site itself uses; promoted ads still get mixed in,
		// so the poller additionally filters by item creation date
		'search[order]': 'created_at:desc',
	});

	if (search.min_price != null) params.set('filter_float_price:from', String(search.min_price));
	if (search.max_price != null) params.set('filter_float_price:to', String(search.max_price));
	if (search.condition === 'NEW') params.set('filter_enum_state[0]', 'new');
	if (search.condition === 'USED') params.set('filter_enum_state[0]', 'used');

	const response = await axios.get(`${OLX_API}?${params.toString()}`, { headers: HEADERS });

	return (response.data.data ?? []).map(normalizeItem);
}
