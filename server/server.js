import express from 'express';
import cors from 'cors';
import fs from 'fs';
import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();

const __filename = fileURLToPath(import.meta.url);

const __dirname = path.dirname(__filename);

const PORT = 3000;
dotenv.config();

app.use(cors());
app.use(express.json());

const SEARCH_FILE = './searchConfig.json';
const DATA_FILE = './data.json';


const dataPath = path.join(__dirname, 'data.json');
const searchPath = path.join(__dirname, 'searchConfig.json')
let token;


async function fetchData(){
	try{
		const rawSearch = fs.readFileSync(searchPath, 'utf-8');
		const searchConfig = JSON.parse(rawSearch);

		console.log(searchConfig);

		const rawData = fs.readFileSync(dataPath,'utf-8');
		const oldData = JSON.parse(rawData).map(item => {return {...item, alreadyPosted: true} });
		const oldDataIds = oldData.map(item => item.itemId);

		const response = await axios.get('https://api.ebay.com/buy/browse/v1/item_summary/search', {
			params: {
				q: searchConfig.searchBy,
				limit: 10,
				sort: 'newlyListed',
				category_ids: '11724'
			},
			headers: {
				'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
				Authorization: `Bearer ${token}`
			}
		})

		let data = response.data.itemSummaries;


		data = data.filter(item => !(oldDataIds.includes(item.itemId)));
		
		const newData = [...oldData, ...data];

		// console.log(newData)

		fs.writeFileSync(dataPath, JSON.stringify(newData, null, 2), 'utf-8')
	}catch(err){
		console.log(err);
	}
	
}	

const clientId = process.env.EBAY_CLIENT_ID;
const clientSecret = process.env.EBAY_CLIENT_SECRET;


// console.log(clientId, clientSecret)

export async function getToken() {

  const base64Credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  
  const response = await axios.post(
    "https://api.ebay.com/identity/v1/oauth2/token",
    new URLSearchParams({
      grant_type: "client_credentials",
      scope: "https://api.ebay.com/oauth/api_scope",
    }),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${base64Credentials}`,
      },
    }
  );

  token = response.data.access_token;

  console.log(token);
}




setInterval(() => getToken(), 3600 * 2 * 1000)

app.post('/searchconfig', async(req, res) => {
	try{
		const raw = fs.readFileSync(searchPath, 'utf-8');
		const json = JSON.parse(raw);

		json.searchBy = req.body;
		console.log('search changed');
		console.log(json.searchBy);

		fs.writeFileSync(searchPath, JSON.stringify(json.searchBy), 'utf8');
	}
	catch(err){
		console.log('err');
	}
});




app.get('/data', async(req, res) => {
	try{
		fetchData();
		const raw = fs.readFileSync(dataPath, 'utf-8');
		const json = JSON.parse(raw).filter(item => !item.alreadyPosted);
		// console.log(json)

		res.json(json);
	}catch(err){
		res.status(500);
	}
})


app.listen(PORT, async () => {
	console.log('server started, port' + PORT);
	await getToken();
	await fetchData();
	// 
});