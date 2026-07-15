import { Telegraf } from 'telegraf'
import dotenv from 'dotenv';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import LocalSession from 'telegraf-session-local';
import moment from 'moment-timezone';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LANGS_FILE = path.join(__dirname, 'langs.json');

const bot = new Telegraf(process.env.BOT_TOKEN)

bot.use(new LocalSession({ database: 'sessions.json' }).middleware());

const BACKEND_IP = process.env.BACKEND_IP;
const BACKEND_URL = `http://${BACKEND_IP}:3000`;
const NOTIFICATION_POLL_INTERVAL_MS = Number(process.env.NOTIFICATION_POLL_INTERVAL_MS) || 20000;

function loadLangs() {
	try {
		return JSON.parse(fs.readFileSync(LANGS_FILE, 'utf-8'));
	} catch (err) {
		return {};
	}
}

const langs = loadLangs();

function getLang(chatId) {
	return langs[chatId] ?? null;
}

function setLang(chatId, lang) {
	langs[chatId] = lang;
	fs.writeFileSync(LANGS_FILE, JSON.stringify(langs, null, 2), 'utf-8');
}

const translations = {
	uk: {
		chooseLanguage: 'Оберіть мову / Choose language:',
		languageSet: 'Мова: Українська',
		welcome: (name) => `Привіт, ${name}! Цей бот моніторить нові оголошення на eBay за вашими пошуковими запитами.`,
		chooseAction: 'Оберіть дію',
		addSearch: '➕ Додати пошук',
		mySearches: '📋 Мої пошуки',
		cancel: '❌ Скасувати',
		skip: '⏭ Пропустити',
		choosePlatform: 'Де шукати?',
		platformSet: (name) => `Платформа: ${name}`,
		enterQuery: 'Введіть пошуковий запит:',
		chooseCategory: 'Оберіть категорію:',
		allCategories: 'Усі категорії',
		category: (label) => `Категорія: ${label}`,
		minPrice: (cur) => `Мінімальна ціна, ${cur} (або пропустіть):`,
		maxPrice: (cur) => `Максимальна ціна, ${cur} (або пропустіть):`,
		enterNumberOrSkip: 'Введіть число або натисніть "Пропустити"',
		conditionPrompt: 'Стан товару:',
		conditionNew: 'Нові',
		conditionUsed: 'Вживані',
		any: 'Будь-який',
		conditionSet: (v) => `Стан: ${v}`,
		buyingOptionPrompt: 'Тип продажу:',
		auction: 'Аукціон',
		fixedPrice: 'Фіксована ціна',
		buyingOptionSet: (v) => `Тип продажу: ${v}`,
		locationPrompt: 'Локація товару:',
		usOnly: 'Тільки США',
		anyLocation: 'Будь-яка',
		locationSet: (v) => `Локація: ${v}`,
		searchAdded: (desc) => `Пошук додано:\n${desc}`,
		addSearchFailed: 'Не вдалося додати пошук',
		cancelled: 'Скасовано',
		noSearches: 'У вас поки немає пошуків. Натисніть "➕ Додати пошук", щоб створити.',
		pause: '⏸ Пауза',
		resume: '▶ Відновити',
		delete: '🗑 Видалити',
		resumed: 'Відновлено',
		paused: 'Призупинено',
		updateFailed: 'Не вдалося оновити пошук',
		deleted: 'Видалено',
		deleteFailed: 'Не вдалося видалити пошук',
		searchDeleted: '🗑 Пошук видалено',
		categoryLabel: (id) => `категорія ${id}`,
		condNewShort: 'нові',
		condUsedShort: 'вживані',
		auctionShort: 'аукціон',
		fixedPriceShort: 'фікс. ціна',
		usOnlyShort: 'тільки США',
		itemShipping: '+ Доставка',
		itemTime: 'Час:',
		itemSeller: 'Продавець:',
		itemPositiveOrders: '% позитивних відгуків',
		itemCondition: 'Стан:',
		itemLocation: 'Місто:',
	},
	en: {
		chooseLanguage: 'Оберіть мову / Choose language:',
		languageSet: 'Language: English',
		welcome: (name) => `Hi, ${name}! This bot monitors new eBay listings for your search queries.`,
		chooseAction: 'Choose action',
		addSearch: '➕ Add search',
		mySearches: '📋 My searches',
		cancel: '❌ Cancel',
		skip: '⏭ Skip',
		choosePlatform: 'Where to search?',
		platformSet: (name) => `Platform: ${name}`,
		enterQuery: 'Enter search query:',
		chooseCategory: 'Choose category:',
		allCategories: 'All categories',
		category: (label) => `Category: ${label}`,
		minPrice: (cur) => `Minimum price, ${cur} (or skip):`,
		maxPrice: (cur) => `Maximum price, ${cur} (or skip):`,
		enterNumberOrSkip: 'Enter a number or tap "Skip"',
		conditionPrompt: 'Item condition:',
		conditionNew: 'New',
		conditionUsed: 'Used',
		any: 'Any',
		conditionSet: (v) => `Condition: ${v}`,
		buyingOptionPrompt: 'Listing type:',
		auction: 'Auction',
		fixedPrice: 'Fixed price',
		buyingOptionSet: (v) => `Listing type: ${v}`,
		locationPrompt: 'Item location:',
		usOnly: 'US only',
		anyLocation: 'Any',
		locationSet: (v) => `Location: ${v}`,
		searchAdded: (desc) => `Search added:\n${desc}`,
		addSearchFailed: 'Failed to add search',
		cancelled: 'Cancelled',
		noSearches: 'You don\'t have any searches yet. Tap "➕ Add search" to create one.',
		pause: '⏸ Pause',
		resume: '▶ Resume',
		delete: '🗑 Delete',
		resumed: 'Resumed',
		paused: 'Paused',
		updateFailed: 'Failed to update search',
		deleted: 'Deleted',
		deleteFailed: 'Failed to delete search',
		searchDeleted: '🗑 Search deleted',
		categoryLabel: (id) => `category ${id}`,
		condNewShort: 'new',
		condUsedShort: 'used',
		auctionShort: 'auction',
		fixedPriceShort: 'fixed price',
		usOnlyShort: 'US only',
		itemShipping: '+ Shipping',
		itemTime: 'Time:',
		itemSeller: 'Seller:',
		itemPositiveOrders: '% positive feedback',
		itemCondition: 'Condition:',
		itemLocation: 'City:',
	},
};

const platformNames = { ebay: 'eBay', olx: 'OLX' };

function currencySymbol(source) {
	return source === 'olx' ? 'грн' : '$';
}

function platformKeyboard() {
	return {
		reply_markup: {
			inline_keyboard: [
				[{ text: 'eBay', callback_data: 'src:ebay' }, { text: 'OLX', callback_data: 'src:olx' }]
			]
		}
	};
}

function t(lang, key, ...args) {
	const dict = translations[lang] || translations.uk;
	const value = dict[key];
	return typeof value === 'function' ? value(...args) : value;
}

function languageKeyboard() {
	return {
		reply_markup: {
			inline_keyboard: [
				[{ text: 'Українська', callback_data: 'lang:uk' }, { text: 'English', callback_data: 'lang:en' }]
			]
		}
	};
}

function mainMenu(lang) {
	return {
		reply_markup: {
			keyboard: [[t(lang, 'addSearch'), t(lang, 'mySearches')]],
			resize_keyboard: true
		}
	};
}

function skipCancelKeyboard(lang) {
	return { reply_markup: { keyboard: [[t(lang, 'skip')], [t(lang, 'cancel')]], resize_keyboard: true } };
}

function cancelOnlyKeyboard(lang) {
	return { reply_markup: { keyboard: [[t(lang, 'cancel')]], resize_keyboard: true } };
}

function conditionKeyboard(lang) {
	return {
		reply_markup: {
			inline_keyboard: [
				[{ text: t(lang, 'conditionNew'), callback_data: 'cond:NEW' }, { text: t(lang, 'conditionUsed'), callback_data: 'cond:USED' }],
				[{ text: t(lang, 'any'), callback_data: 'cond:any' }]
			]
		}
	};
}

function buyingOptionKeyboard(lang) {
	return {
		reply_markup: {
			inline_keyboard: [
				[{ text: t(lang, 'auction'), callback_data: 'buy:AUCTION' }, { text: t(lang, 'fixedPrice'), callback_data: 'buy:FIXED_PRICE' }],
				[{ text: t(lang, 'any'), callback_data: 'buy:any' }]
			]
		}
	};
}

function locationKeyboard(lang) {
	return {
		reply_markup: {
			inline_keyboard: [
				[{ text: t(lang, 'usOnly'), callback_data: 'loc:us' }, { text: t(lang, 'anyLocation'), callback_data: 'loc:any' }]
			]
		}
	};
}

function showMenu(ctx) {
	const lang = getLang(ctx.chat.id);
	ctx.reply(t(lang, 'chooseAction'), mainMenu(lang));
}

function formatItem(item, lang) {
	const time = moment.utc(item.itemCreationDate).tz('Europe/Kyiv').format('LLLL');

	if (item.source === 'olx') {
		const price = item.price.label ?? `${item.price.value} ${item.price.currency}`;
		const lines = [item.title, price, `${t(lang, 'itemTime')} ${time}`];
		if (item.location) lines.push(`${t(lang, 'itemLocation')} ${item.location}`);
		if (item.condition) lines.push(`${t(lang, 'itemCondition')} ${item.condition}`);
		lines.push(item.itemWebUrl);
		return lines.join(' \n ');
	}

	return `${item.title} \n ${item.price.value + ' ' + item.price.currency} ${t(lang, 'itemShipping')}  \n ${t(lang, 'itemTime')} ${time} \n ${t(lang, 'itemSeller')} ${item.seller.feedbackPercentage} ${t(lang, 'itemPositiveOrders')} (${item.seller.feedbackScore}) \n ${t(lang, 'itemCondition')} ${item.condition} \n	${item.itemWebUrl}`;
}

function describeSearch(search, lang) {
	const parts = [`[${platformNames[search.source] ?? 'eBay'}] ${search.query}`];

	if (search.category_id) parts.push(t(lang, 'categoryLabel', search.category_id));
	if (search.min_price != null || search.max_price != null) {
		const min = search.min_price != null ? search.min_price : '';
		const max = search.max_price != null ? search.max_price : '';
		parts.push(`${min}-${max} ${currencySymbol(search.source)}`);
	}
	if (search.condition) parts.push(search.condition === 'NEW' ? t(lang, 'condNewShort') : t(lang, 'condUsedShort'));
	if (search.buying_option) parts.push(search.buying_option === 'AUCTION' ? t(lang, 'auctionShort') : t(lang, 'fixedPriceShort'));
	if (search.us_only) parts.push(t(lang, 'usOnlyShort'));

	return parts.join(' | ');
}

function searchButtons(search, lang) {
	return {
		inline_keyboard: [
			[
				search.active
					? { text: t(lang, 'pause'), callback_data: `toggle:${search.id}:${search.active}` }
					: { text: t(lang, 'resume'), callback_data: `toggle:${search.id}:${search.active}` },
				{ text: t(lang, 'delete'), callback_data: `del:${search.id}` }
			]
		]
	};
}

async function sendCategoryChoices(ctx, query, lang) {
	let suggestions = [];
	try {
		const { data } = await axios.get(`${BACKEND_URL}/categories/suggest`, { params: { q: query } });
		suggestions = data;
	} catch (err) {
		console.log('category suggestion fetch failed', err.message);
	}

	const labels = {};
	const buttons = suggestions.map((s) => {
		labels[s.categoryId] = s.parentName ? `${s.categoryName} (${s.parentName})` : s.categoryName;
		return [{ text: labels[s.categoryId], callback_data: `cat:${s.categoryId}` }];
	});
	buttons.push([{ text: t(lang, 'allCategories'), callback_data: 'cat:any' }]);

	ctx.session.categoryLabels = labels;
	await ctx.reply(t(lang, 'chooseCategory'), { reply_markup: { inline_keyboard: buttons } });
}

async function sendMySearches(ctx) {
	const chatId = ctx.chat.id;
	const lang = getLang(chatId);
	const { data: searches } = await axios.get(`${BACKEND_URL}/searches`, { params: { chatId } });

	if (searches.length === 0) {
		await ctx.reply(t(lang, 'noSearches'));
		return;
	}

	for (const search of searches) {
		const status = search.active ? '🟢' : '⏸';
		await ctx.reply(`${status} ${describeSearch(search, lang)}`, { reply_markup: searchButtons(search, lang) });
	}
}

async function cancelWizard(ctx) {
	const lang = getLang(ctx.chat.id);
	ctx.session.state = 'default';
	ctx.session.draft = {};
	ctx.session.categoryLabels = {};
	await ctx.reply(t(lang, 'cancelled'), mainMenu(lang));
}

async function finishWizard(ctx) {
	const lang = getLang(ctx.chat.id);
	try {
		const { data: search } = await axios.post(`${BACKEND_URL}/searches`, { chatId: ctx.chat.id, ...ctx.session.draft });
		await ctx.reply(t(lang, 'searchAdded', describeSearch(search, lang)), mainMenu(lang));
	} catch (err) {
		const message = err.response?.data?.error || t(lang, 'addSearchFailed');
		await ctx.reply(message, mainMenu(lang));
	}
	ctx.session.state = 'default';
	ctx.session.draft = {};
	ctx.session.categoryLabels = {};
}

bot.use(async (ctx, next) => {
	if (!ctx.chat) return next();

	const isLangChoice = ctx.callbackQuery?.data?.startsWith('lang:');
	if (!getLang(ctx.chat.id) && !isLangChoice) {
		await ctx.reply(translations.uk.chooseLanguage, languageKeyboard());
		return;
	}

	return next();
});

bot.action(/^lang:(uk|en)$/, async (ctx) => {
	await ctx.answerCbQuery();
	const lang = ctx.match[1];
	setLang(ctx.chat.id, lang);

	await ctx.editMessageText(t(lang, 'languageSet'));
	await ctx.reply(t(lang, 'welcome', ctx.from.username || ctx.from.first_name), mainMenu(lang));
});

bot.start(ctx => {
	const lang = getLang(ctx.chat.id);
	ctx.reply(t(lang, 'welcome', ctx.from.username || ctx.from.first_name));
	showMenu(ctx);
});

bot.hears([translations.uk.addSearch, translations.en.addSearch], async (ctx) => {
	const lang = getLang(ctx.chat.id);
	ctx.session.draft = {};
	ctx.session.state = "awaitingPlatform";
	await ctx.reply(t(lang, 'choosePlatform'), platformKeyboard());
});

bot.action(/^src:(ebay|olx)$/, async (ctx) => {
	await ctx.answerCbQuery();
	if (ctx.session.state !== 'awaitingPlatform') return;
	const lang = getLang(ctx.chat.id);

	const source = ctx.match[1];
	ctx.session.draft.source = source;

	await ctx.editMessageText(t(lang, 'platformSet', platformNames[source]));
	ctx.session.state = 'awaitingQuery';
	await ctx.reply(t(lang, 'enterQuery'), cancelOnlyKeyboard(lang));
});

bot.hears([translations.uk.mySearches, translations.en.mySearches], async (ctx) => {
	await sendMySearches(ctx);
});

bot.action(/^toggle:(\d+):(true|false)$/, async (ctx) => {
	const id = ctx.match[1];
	const currentActive = ctx.match[2] === 'true';
	const chatId = ctx.chat.id;
	const lang = getLang(chatId);

	try {
		const { data: search } = await axios.patch(`${BACKEND_URL}/searches/${id}`, { chatId, active: !currentActive });
		await ctx.editMessageReplyMarkup(searchButtons(search, lang));
		await ctx.answerCbQuery(search.active ? t(lang, 'resumed') : t(lang, 'paused'));
	} catch (err) {
		await ctx.answerCbQuery(t(lang, 'updateFailed'));
	}
});

bot.action(/^del:(\d+)$/, async (ctx) => {
	const id = ctx.match[1];
	const chatId = ctx.chat.id;
	const lang = getLang(chatId);

	try {
		await axios.delete(`${BACKEND_URL}/searches/${id}`, { params: { chatId } });
		await ctx.editMessageText(t(lang, 'searchDeleted'));
		await ctx.answerCbQuery(t(lang, 'deleted'));
	} catch (err) {
		await ctx.answerCbQuery(t(lang, 'deleteFailed'));
	}
});

bot.action(/^cat:(.+)$/, async (ctx) => {
	await ctx.answerCbQuery();
	if (ctx.session.state !== 'awaitingCategory') return;
	const lang = getLang(ctx.chat.id);

	const value = ctx.match[1];
	let label;
	if (value === 'any') {
		label = t(lang, 'allCategories');
	} else {
		ctx.session.draft.categoryId = value;
		label = ctx.session.categoryLabels?.[value] ?? value;
	}

	await ctx.editMessageText(t(lang, 'category', label));
	ctx.session.state = 'awaitingMinPrice';
	await ctx.reply(t(lang, 'minPrice', currencySymbol(ctx.session.draft.source)), skipCancelKeyboard(lang));
});

bot.action(/^cond:(NEW|USED|any)$/, async (ctx) => {
	await ctx.answerCbQuery();
	if (ctx.session.state !== 'awaitingCondition') return;
	const lang = getLang(ctx.chat.id);

	const value = ctx.match[1];
	if (value !== 'any') ctx.session.draft.condition = value;

	const label = value === 'any' ? t(lang, 'any') : value === 'NEW' ? t(lang, 'conditionNew') : t(lang, 'conditionUsed');
	await ctx.editMessageText(t(lang, 'conditionSet', label));

	if (ctx.session.draft.source === 'olx') {
		await finishWizard(ctx);
		return;
	}

	ctx.session.state = 'awaitingBuyingOption';
	await ctx.reply(t(lang, 'buyingOptionPrompt'), buyingOptionKeyboard(lang));
});

bot.action(/^buy:(AUCTION|FIXED_PRICE|any)$/, async (ctx) => {
	await ctx.answerCbQuery();
	if (ctx.session.state !== 'awaitingBuyingOption') return;
	const lang = getLang(ctx.chat.id);

	const value = ctx.match[1];
	if (value !== 'any') ctx.session.draft.buyingOption = value;

	const label = value === 'any' ? t(lang, 'any') : value === 'AUCTION' ? t(lang, 'auction') : t(lang, 'fixedPrice');
	await ctx.editMessageText(t(lang, 'buyingOptionSet', label));
	ctx.session.state = 'awaitingLocation';
	await ctx.reply(t(lang, 'locationPrompt'), locationKeyboard(lang));
});

bot.action(/^loc:(us|any)$/, async (ctx) => {
	await ctx.answerCbQuery();
	if (ctx.session.state !== 'awaitingLocation') return;
	const lang = getLang(ctx.chat.id);

	const value = ctx.match[1];
	ctx.session.draft.usOnly = value === 'us';

	const label = value === 'us' ? t(lang, 'usOnly') : t(lang, 'anyLocation');
	await ctx.editMessageText(t(lang, 'locationSet', label));
	await finishWizard(ctx);
});

bot.on("message", async (ctx) => {
	const state = ctx.session.state;
	const text = ctx.message.text;
	const lang = getLang(ctx.chat.id);

	if (text === t(lang, 'cancel') && state && state.startsWith('awaiting')) {
		await cancelWizard(ctx);
		return;
	}

	if (state === 'awaitingQuery' && text) {
		ctx.session.draft.query = text;

		if (ctx.session.draft.source === 'olx') {
			ctx.session.state = 'awaitingMinPrice';
			await ctx.reply(t(lang, 'minPrice', currencySymbol('olx')), skipCancelKeyboard(lang));
			return;
		}

		ctx.session.state = 'awaitingCategory';
		await sendCategoryChoices(ctx, text, lang);
		return;
	}

	if (state === 'awaitingMinPrice' && text) {
		if (text !== t(lang, 'skip')) {
			const value = Number(text);
			if (Number.isNaN(value)) {
				await ctx.reply(t(lang, 'enterNumberOrSkip'));
				return;
			}
			ctx.session.draft.minPrice = value;
		}
		ctx.session.state = 'awaitingMaxPrice';
		await ctx.reply(t(lang, 'maxPrice', currencySymbol(ctx.session.draft.source)), skipCancelKeyboard(lang));
		return;
	}

	if (state === 'awaitingMaxPrice' && text) {
		if (text !== t(lang, 'skip')) {
			const value = Number(text);
			if (Number.isNaN(value)) {
				await ctx.reply(t(lang, 'enterNumberOrSkip'));
				return;
			}
			ctx.session.draft.maxPrice = value;
		}
		ctx.session.state = 'awaitingCondition';
		await ctx.reply(t(lang, 'conditionPrompt'), conditionKeyboard(lang));
		return;
	}

	if (ctx.message.text === "menu" || ctx.message.text === "/menu") {
		showMenu(ctx);
	}
})

function startNotificationPoller() {
	setInterval(async () => {
		try {
			const { data: groups } = await axios.get(`${BACKEND_URL}/notifications/all`);
			for (const { chatId, items } of groups) {
				const lang = getLang(chatId) || 'uk';
				for (const item of items) {
					await bot.telegram.sendMessage(chatId, formatItem(item, lang));
				}
			}
		} catch (err) {
			console.log('notification poll failed', err.message);
		}
	}, NOTIFICATION_POLL_INTERVAL_MS);
}

bot.launch()
startNotificationPoller();

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))
