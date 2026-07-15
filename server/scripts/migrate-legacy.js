import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const { init, listSearchesByChat, createSearch, markSeen } = await import('../db.js');

async function main() {
	const chatId = process.argv[2];
	if (!chatId) {
		console.log('Usage: node scripts/migrate-legacy.js <chatId>');
		process.exit(1);
	}

	const searchConfigPath = path.join(__dirname, '..', 'searchConfig.json');
	const dataPath = path.join(__dirname, '..', 'data.json');

	const searchConfig = JSON.parse(fs.readFileSync(searchConfigPath, 'utf-8'));
	const oldData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

	await init();

	const existing = await listSearchesByChat(chatId);
	const alreadyMigrated = existing.find((s) => s.query === searchConfig.searchBy);
	if (alreadyMigrated) {
		console.log(`Search "${searchConfig.searchBy}" already exists for chat ${chatId}, skipping creation.`);
		process.exit(0);
	}

	const search = await createSearch(chatId, searchConfig.searchBy);
	console.log(`Created search ${search.id} ("${search.query}") for chat ${chatId}`);

	for (const item of oldData) {
		await markSeen(search.id, item.itemId);
	}
	console.log(`Seeded ${oldData.length} seen items so they won't be re-notified.`);

	process.exit(0);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
