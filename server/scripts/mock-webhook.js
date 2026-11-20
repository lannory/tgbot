// Simulates a MockProvider webhook for local development:
//   node scripts/mock-webhook.js <external_id> <status> <amount_minor> <currency>
// e.g. node scripts/mock-webhook.js mock_123 paid 9900 UAH
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import axios from 'axios';

import { signMockPayload, MOCK_SIGNATURE_HEADER } from '../billing/providers/mock.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const [externalId, status = 'paid', amount, currency = 'UAH'] = process.argv.slice(2);
if (!externalId || amount == null) {
	console.log('Usage: node scripts/mock-webhook.js <external_id> <status> <amount_minor> <currency>');
	process.exit(1);
}
if (!process.env.MOCK_PAYMENT_SECRET) {
	console.log('MOCK_PAYMENT_SECRET is not set in server/.env');
	process.exit(1);
}

const body = JSON.stringify({ external_id: externalId, status, amount: Number(amount), currency });
const url = `${process.env.WEBHOOK_BASE_URL || 'http://127.0.0.1:3000'}/webhooks/payments/mock`;

const response = await axios.post(url, body, {
	headers: {
		'Content-Type': 'application/json',
		[MOCK_SIGNATURE_HEADER]: signMockPayload(process.env.MOCK_PAYMENT_SECRET, Buffer.from(body)),
	},
	validateStatus: () => true,
});
console.log(response.status, response.data);
