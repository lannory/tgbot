import axios from 'axios';
import { saveEbayToken, updateEbayAccessToken, getEbayToken } from './db.js';

const clientId = process.env.EBAY_CLIENT_ID;
const clientSecret = process.env.EBAY_CLIENT_SECRET;
const ruName = process.env.EBAY_RU_NAME;

const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
// base scope is enough for Trading API calls with an IAF user token;
// extend here if a live PlaceOffer test demands more
const SCOPES = 'https://api.ebay.com/oauth/api_scope';

function basicAuthHeader() {
	return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
}

export function getConsentUrl() {
	const params = new URLSearchParams({
		client_id: clientId,
		redirect_uri: ruName,
		response_type: 'code',
		scope: SCOPES,
	});
	return `https://auth.ebay.com/oauth2/authorize?${params.toString()}`;
}

export async function exchangeCode(chatId, code) {
	const response = await axios.post(
		TOKEN_URL,
		new URLSearchParams({
			grant_type: 'authorization_code',
			code,
			redirect_uri: ruName,
		}),
		{
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				Authorization: basicAuthHeader(),
			},
		}
	);

	const { access_token, expires_in, refresh_token } = response.data;

	await saveEbayToken(chatId, {
		refreshToken: refresh_token,
		accessToken: access_token,
		accessExpiresAt: new Date(Date.now() + expires_in * 1000),
	});
}

export async function isLinked(chatId) {
	return (await getEbayToken(chatId)) !== null;
}

export async function getUserAccessToken(chatId) {
	const row = await getEbayToken(chatId);
	if (!row) {
		throw new Error('eBay account not linked');
	}

	const expiresAt = row.access_expires_at ? new Date(row.access_expires_at).getTime() : 0;
	if (row.access_token && Date.now() < expiresAt - 5 * 60_000) {
		return row.access_token;
	}

	const response = await axios.post(
		TOKEN_URL,
		new URLSearchParams({
			grant_type: 'refresh_token',
			refresh_token: row.refresh_token,
			scope: SCOPES,
		}),
		{
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				Authorization: basicAuthHeader(),
			},
		}
	);

	const { access_token, expires_in } = response.data;
	await updateEbayAccessToken(chatId, access_token, new Date(Date.now() + expires_in * 1000));

	return access_token;
}
