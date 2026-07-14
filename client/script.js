import { Telegraf } from 'telegraf'
import dotenv from 'dotenv';
import axios from 'axios';
import LocalSession from 'telegraf-session-local';
import moment from 'moment-timezone';

dotenv.config();

const bot = new Telegraf(process.env.BOT_TOKEN)

bot.use(new LocalSession({ database: 'sessions.json' }).middleware());

const BACKEND_IP = process.env.BACKEND_IP;
const BACKEND_URL = `http://${BACKEND_IP}:3000`;
const NOTIFICATION_POLL_INTERVAL_MS = Number(process.env.NOTIFICATION_POLL_INTERVAL_MS) || 20000;

const SKIP = "⏭ Пропустити";
const CANCEL = "❌ Скасувати";

const mainMenu = {
	reply_markup: {
		keyboard: [
			["➕ Додати пошук", "📋 Мої пошуки"]
		],
		resize_keyboard: true
	}
};

function skipCancelKeyboard() {
	return { reply_markup: { keyboard: [[SKIP], [CANCEL]], resize_keyboard: true } };
}

function cancelOnlyKeyboard() {
	return { reply_markup: { keyboard: [[CANCEL]], resize_keyboard: true } };
}

function conditionKeyboard() {
	return {
		reply_markup: {
			inline_keyboard: [
				[{ text: 'Нові', callback_data: 'cond:NEW' }, { text: 'Вживані', callback_data: 'cond:USED' }],
				[{ text: 'Будь-який', callback_data: 'cond:any' }]
			]
		}
	};
}

function buyingOptionKeyboard() {
	return {
		reply_markup: {
			inline_keyboard: [
				[{ text: 'Аукціон', callback_data: 'buy:AUCTION' }, { text: 'Фіксована ціна', callback_data: 'buy:FIXED_PRICE' }],
				[{ text: 'Будь-який', callback_data: 'buy:any' }]
			]
		}
	};
}

function locationKeyboard() {
	return {
		reply_markup: {
			inline_keyboard: [
				[{ text: 'Тільки США', callback_data: 'loc:us' }, { text: 'Будь-яка', callback_data: 'loc:any' }]
			]
		}
	};
}

function showMenu(ctx) {
	ctx.reply("Оберіть дію", mainMenu);
}

function formatItem(item) {
	return `${item.title} \n ${item.price.value + ' ' + item.price.currency} + Shipping  \n Time: ${moment.utc(item.itemCreationDate).tz('Europe/Kyiv').format('LLLL')} \n Seller: ${item.seller.feedbackPercentage} % positive orders ${item.seller.feedbackScore} \n Condition: ${item.condition} \n	${item.itemWebUrl}`;
}

function describeSearch(search) {
	const parts = [search.query];

	if (search.category_id) parts.push(`категорія ${search.category_id}`);
	if (search.min_price != null || search.max_price != null) {
		const min = search.min_price != null ? search.min_price : '';
		const max = search.max_price != null ? search.max_price : '';
		parts.push(`$${min}-${max}`);
	}
	if (search.condition) parts.push(search.condition === 'NEW' ? 'нові' : 'вживані');
	if (search.buying_option) parts.push(search.buying_option === 'AUCTION' ? 'аукціон' : 'фікс. ціна');
	if (search.us_only) parts.push('тільки США');

	return parts.join(' | ');
}

function searchButtons(search) {
	return {
		inline_keyboard: [
			[
				search.active
					? { text: '⏸ Пауза', callback_data: `toggle:${search.id}:${search.active}` }
					: { text: '▶ Відновити', callback_data: `toggle:${search.id}:${search.active}` },
				{ text: '🗑 Видалити', callback_data: `del:${search.id}` }
			]
		]
	};
}

async function sendCategoryChoices(ctx, query) {
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
	buttons.push([{ text: 'Усі категорії', callback_data: 'cat:any' }]);

	ctx.session.categoryLabels = labels;
	await ctx.reply("Оберіть категорію:", { reply_markup: { inline_keyboard: buttons } });
}

async function sendMySearches(ctx) {
	const chatId = ctx.chat.id;
	const { data: searches } = await axios.get(`${BACKEND_URL}/searches`, { params: { chatId } });

	if (searches.length === 0) {
		await ctx.reply("У вас поки немає пошуків. Натисніть \"➕ Додати пошук\", щоб створити.");
		return;
	}

	for (const search of searches) {
		const status = search.active ? '🟢' : '⏸';
		await ctx.reply(`${status} ${describeSearch(search)}`, { reply_markup: searchButtons(search) });
	}
}

async function cancelWizard(ctx) {
	ctx.session.state = 'default';
	ctx.session.draft = {};
	ctx.session.categoryLabels = {};
	await ctx.reply("Скасовано", mainMenu);
}

async function finishWizard(ctx) {
	try {
		const { data: search } = await axios.post(`${BACKEND_URL}/searches`, { chatId: ctx.chat.id, ...ctx.session.draft });
		await ctx.reply(`Пошук додано:\n${describeSearch(search)}`, mainMenu);
	} catch (err) {
		const message = err.response?.data?.error || 'Не вдалося додати пошук';
		await ctx.reply(message, mainMenu);
	}
	ctx.session.state = 'default';
	ctx.session.draft = {};
	ctx.session.categoryLabels = {};
}

bot.start(ctx => {
	ctx.reply(`Привіт, ${ctx.message.from.username}! Цей бот моніторить нові оголошення на eBay за вашими пошуковими запитами.`);
	showMenu(ctx);
});

bot.hears("➕ Додати пошук", async (ctx) => {
	ctx.session.draft = {};
	ctx.session.state = "awaitingQuery";
	await ctx.reply("Введіть пошуковий запит:", cancelOnlyKeyboard());
});

bot.hears("📋 Мої пошуки", async (ctx) => {
	await sendMySearches(ctx);
});

bot.action(/^toggle:(\d+):(true|false)$/, async (ctx) => {
	const id = ctx.match[1];
	const currentActive = ctx.match[2] === 'true';
	const chatId = ctx.chat.id;

	try {
		const { data: search } = await axios.patch(`${BACKEND_URL}/searches/${id}`, { chatId, active: !currentActive });
		await ctx.editMessageReplyMarkup(searchButtons(search));
		await ctx.answerCbQuery(search.active ? 'Відновлено' : 'Призупинено');
	} catch (err) {
		await ctx.answerCbQuery('Не вдалося оновити пошук');
	}
});

bot.action(/^del:(\d+)$/, async (ctx) => {
	const id = ctx.match[1];
	const chatId = ctx.chat.id;

	try {
		await axios.delete(`${BACKEND_URL}/searches/${id}`, { params: { chatId } });
		await ctx.editMessageText('🗑 Пошук видалено');
		await ctx.answerCbQuery('Видалено');
	} catch (err) {
		await ctx.answerCbQuery('Не вдалося видалити пошук');
	}
});

bot.action(/^cat:(.+)$/, async (ctx) => {
	await ctx.answerCbQuery();
	if (ctx.session.state !== 'awaitingCategory') return;

	const value = ctx.match[1];
	let label;
	if (value === 'any') {
		label = 'усі категорії';
	} else {
		ctx.session.draft.categoryId = value;
		label = ctx.session.categoryLabels?.[value] ?? value;
	}

	await ctx.editMessageText(`Категорія: ${label}`);
	ctx.session.state = 'awaitingMinPrice';
	await ctx.reply("Мінімальна ціна, $ (або пропустіть):", skipCancelKeyboard());
});

bot.action(/^cond:(NEW|USED|any)$/, async (ctx) => {
	await ctx.answerCbQuery();
	if (ctx.session.state !== 'awaitingCondition') return;

	const value = ctx.match[1];
	if (value !== 'any') ctx.session.draft.condition = value;

	await ctx.editMessageText(`Стан: ${value === 'any' ? 'будь-який' : value === 'NEW' ? 'нові' : 'вживані'}`);
	ctx.session.state = 'awaitingBuyingOption';
	await ctx.reply("Тип продажу:", buyingOptionKeyboard());
});

bot.action(/^buy:(AUCTION|FIXED_PRICE|any)$/, async (ctx) => {
	await ctx.answerCbQuery();
	if (ctx.session.state !== 'awaitingBuyingOption') return;

	const value = ctx.match[1];
	if (value !== 'any') ctx.session.draft.buyingOption = value;

	await ctx.editMessageText(`Тип продажу: ${value === 'any' ? 'будь-який' : value === 'AUCTION' ? 'аукціон' : 'фіксована ціна'}`);
	ctx.session.state = 'awaitingLocation';
	await ctx.reply("Локація товару:", locationKeyboard());
});

bot.action(/^loc:(us|any)$/, async (ctx) => {
	await ctx.answerCbQuery();
	if (ctx.session.state !== 'awaitingLocation') return;

	const value = ctx.match[1];
	ctx.session.draft.usOnly = value === 'us';

	await ctx.editMessageText(`Локація: ${value === 'us' ? 'тільки США' : 'будь-яка'}`);
	await finishWizard(ctx);
});

bot.on("message", async (ctx) => {
	const state = ctx.session.state;
	const text = ctx.message.text;

	if (text === CANCEL && state && state.startsWith('awaiting')) {
		await cancelWizard(ctx);
		return;
	}

	if (state === 'awaitingQuery' && text) {
		ctx.session.draft.query = text;
		ctx.session.state = 'awaitingCategory';
		await sendCategoryChoices(ctx, text);
		return;
	}

	if (state === 'awaitingMinPrice' && text) {
		if (text !== SKIP) {
			const value = Number(text);
			if (Number.isNaN(value)) {
				await ctx.reply("Введіть число або натисніть \"Пропустити\"");
				return;
			}
			ctx.session.draft.minPrice = value;
		}
		ctx.session.state = 'awaitingMaxPrice';
		await ctx.reply("Максимальна ціна, $ (або пропустіть):", skipCancelKeyboard());
		return;
	}

	if (state === 'awaitingMaxPrice' && text) {
		if (text !== SKIP) {
			const value = Number(text);
			if (Number.isNaN(value)) {
				await ctx.reply("Введіть число або натисніть \"Пропустити\"");
				return;
			}
			ctx.session.draft.maxPrice = value;
		}
		ctx.session.state = 'awaitingCondition';
		await ctx.reply("Стан товару:", conditionKeyboard());
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
				for (const item of items) {
					await bot.telegram.sendMessage(chatId, formatItem(item));
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
