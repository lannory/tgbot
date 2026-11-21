import { USER_STATUSES, PLATFORM_FILTERS, PAGE_SIZES, SORT_KEYS } from './queries/users.js';
import { parseMoney } from './format.js';
import { SOURCES } from '../billing/entitlements.js';

export const CHAT_ID_RE = /^-?\d{1,20}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function str(v, max = 200) {
	return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function validDate(v) {
	if (!DATE_RE.test(v)) return '';
	const d = new Date(`${v}T00:00:00Z`);
	return Number.isNaN(d.getTime()) ? '' : v;
}

export function positiveInt(v, { min = 1, max = 2_147_483_647 } = {}) {
	const s = String(v ?? '').trim();
	if (!/^\d{1,10}$/.test(s)) return null;
	const n = Number(s);
	return n >= min && n <= max ? n : null;
}

// Query string of /users -> clean filter object (unknown values dropped)
export function parseUserFilters(query, planCodes) {
	const status = str(query.status);
	const platform = str(query.platform);
	const plan = str(query.plan, 32);
	const sort = str(query.sort);
	const pageSize = positiveInt(query.size) ?? 25;

	return {
		q: str(query.q, 100),
		status: USER_STATUSES.includes(status) ? status : '',
		platform: PLATFORM_FILTERS.includes(platform) ? platform : '',
		plan: planCodes.includes(plan) ? plan : '',
		regFrom: validDate(str(query.reg_from, 10)),
		regTo: validDate(str(query.reg_to, 10)),
		sort: SORT_KEYS.includes(sort) ? sort : 'created_at',
		dir: query.dir === 'asc' ? 'asc' : 'desc',
		page: positiveInt(query.page, { max: 100_000 }) ?? 1,
		pageSize: PAGE_SIZES.includes(pageSize) ? pageSize : 25,
	};
}

export function reasonFrom(body, { required = false } = {}) {
	const reason = str(body?.reason, 500);
	if (required && !reason) return { error: 'Вкажіть причину' };
	return { reason: reason || null };
}

// Plan form -> { plan } or { error }
export function parsePlanForm(body) {
	const code = str(body.code, 32).toLowerCase();
	const name = str(body.name, 64);
	const currency = str(body.currency, 3).toUpperCase();
	const platforms = [].concat(body.platforms ?? []).filter((p) => SOURCES.includes(p));

	if (!/^[a-z0-9_-]{1,32}$/.test(code)) return { error: 'Код: лише латиниця, цифри, «_» і «-»' };
	if (!name) return { error: 'Вкажіть назву' };
	if (!/^[A-Z]{3}$/.test(currency)) return { error: 'Валюта: три латинські літери (UAH, USD, XTR…)' };

	const priceMinor = parseMoney(body.price, currency);
	if (priceMinor == null) return { error: 'Некоректна ціна' };

	const durationRaw = str(body.duration_days);
	const durationDays = durationRaw === '' ? null : positiveInt(durationRaw, { max: 3650 });
	if (durationRaw !== '' && durationDays == null) return { error: 'Тривалість: ціле число днів (1–3650) або порожньо' };

	const maxRaw = str(body.max_searches);
	const maxSearches = maxRaw === '' ? null : positiveInt(maxRaw, { min: 0, max: 10_000 });
	if (maxRaw !== '' && maxSearches == null) return { error: 'Макс. пошуків: ціле число або порожньо (без ліміту)' };

	const interval = positiveInt(body.check_interval_sec, { min: 10, max: 86_400 });
	if (interval == null) return { error: 'Інтервал перевірки: від 10 до 86400 секунд' };

	if (platforms.length === 0) return { error: 'Оберіть хоча б одну платформу' };

	return {
		plan: {
			code,
			name,
			price_minor: priceMinor,
			currency,
			duration_days: durationDays,
			max_searches: maxSearches,
			platforms: [...new Set(platforms)],
			check_interval_sec: interval,
			is_active: body.is_active === 'on',
			is_default: body.is_default === 'on',
		},
	};
}
