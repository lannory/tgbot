// View helpers exposed to templates as `fmt`

const ZERO_DECIMAL_CURRENCIES = new Set(['XTR', 'JPY']);

export function currencyDecimals(currency) {
	return ZERO_DECIMAL_CURRENCIES.has(currency) ? 0 : 2;
}

// Integer minor units -> "1 234.50 UAH" (no floating point involved)
export function formatMoney(minor, currency) {
	if (minor == null) return '—';
	const decimals = currencyDecimals(currency);
	const negative = Number(minor) < 0;
	const digits = String(Math.abs(Math.trunc(Number(minor)))).padStart(decimals + 1, '0');
	const whole = decimals ? digits.slice(0, -decimals) : digits;
	const frac = decimals ? digits.slice(-decimals) : '';
	const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
	return `${negative ? '-' : ''}${grouped}${frac ? '.' + frac : ''} ${currency}`;
}

// "99.5" / "99,50" -> 9950 for the given currency; null if invalid
export function parseMoney(input, currency) {
	const decimals = currencyDecimals(currency);
	const text = String(input ?? '').trim().replace(',', '.');
	const re = decimals ? new RegExp(`^(\\d{1,9})(?:\\.(\\d{1,${decimals}}))?$`) : /^(\d{1,9})$/;
	const m = text.match(re);
	if (!m) return null;
	const frac = (m[2] ?? '').padEnd(decimals, '0');
	const value = Number(m[1] + frac);
	return Number.isSafeInteger(value) && value <= 2_147_483_647 ? value : null;
}

export function createFormatters(timezone) {
	const dateTime = new Intl.DateTimeFormat('uk-UA', { timeZone: timezone, dateStyle: 'short', timeStyle: 'short' });
	const date = new Intl.DateTimeFormat('uk-UA', { timeZone: timezone, dateStyle: 'short' });

	return {
		money: formatMoney,
		dateTime: (d) => (d ? dateTime.format(new Date(d)) : '—'),
		date: (d) => (d ? date.format(new Date(d)) : '—'),
		status: (s) => ({ active: 'активний', bot_blocked: 'заблокував бота', admin_blocked: 'заблокований адміном' }[s] ?? s),
		platform: (p) => ({ ebay: 'eBay', olx: 'OLX' }[p] ?? p ?? '—'),
		dash: (v) => (v == null || v === '' ? '—' : v),
	};
}
