import { Telegraf } from 'telegraf'
import { message } from 'telegraf/filters'
import path from 'path'
import dotenv from'dotenv';
import { keyboard } from 'telegraf/markup';
import axios from 'axios';
import LocalSession from 'telegraf-session-local';
import moment from 'moment';


dotenv.config();

const bot = new Telegraf(process.env.BOT_TOKEN)


bot.use(new LocalSession({ database: 'sessions.json' }).middleware());



bot.start(ctx => ctx.reply(ctx.message.from.username + 'hello'));



function showMenu (bot, chatId) {
	bot.telegram.sendMessage(chatId, "Choose action", {
		reply_markup: {
			keyboard: [
				[
					"Select search", "Search", "Close menu"
				]
			]
		}
	})
}


const fetchData = async (bot, chatId, ctx) => {
	const response = await axios.get('http://localhost:3000/data').catch((err) => console.log(err));
	const result = response.data;
	console.log(result)

	postData(bot, chatId, result);
};

const postData = (bot, chatId, data) => {
	const modArr = data.map(({title, seller, itemWebUrl, price, condition, itemCreationDate}) => {; return {
		title, 
		sellerInfo: {feedback: seller.feedbackPercentage, score: seller.feedbackScore},
		url: itemWebUrl,
		price,
		condition,
		date: itemCreationDate
	}});


	modArr.forEach(item => {
		bot.telegram.sendMessage(chatId, `${item.title} \n ${item.price.value + ' ' + item.price.currency} + Shipping  \n Time: ${moment(item.date).format('LLLL')} \n Seller: ${item.sellerInfo.feedback} % positive orders ${item.sellerInfo.score} \n Condition: ${item.condition} \n	${item.url}`);
		
	});
	
};


bot.on("message", async (ctx) => {
	const chatId = ctx.chat.id;

	
	if(ctx.session.state == 'awaitingSearchText'){
		const userText = ctx.message.text;
		console.log(userText);

		await ctx.reply(`Search value was set to ${ctx.session.search}`);
		ctx.session.state = 'default';
		await axios.post('https://localhost:3000/searchconfig', {body: userText});
		console.log(ctx.session.search)
		return;
	}

	if(ctx.message.text === "menu"){
		showMenu(bot, chatId);
	}else if (ctx.message.text === "Select search"){
		ctx.session.state = "awaitingSearchText";
		await ctx.reply("Enter search text:");
		console.log('set')
	}
	else if(ctx.message.text === 'Search'){
		fetchData(bot, chatId, ctx);
		setInterval(() => fetchData(bot, chatId, ctx), 60000);
	}
	
})

bot.launch()

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))

