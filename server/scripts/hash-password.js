// Prints a bcrypt hash for the admin panel password:
//   npm run admin:hash-password
// The password is read from the terminal without echo (or from stdin when
// piped) and is never passed on the command line or written anywhere.
import bcrypt from 'bcryptjs';

const COST = 12;
const MIN_LENGTH = 12;

function readHidden(prompt) {
	return new Promise((resolve, reject) => {
		const { stdin, stdout } = process;
		stdout.write(prompt);
		stdin.setRawMode(true);
		stdin.resume();
		stdin.setEncoding('utf-8');
		let value = '';

		const onData = (chunk) => {
			for (const ch of chunk) {
				if (ch === '\r' || ch === '\n') {
					stdin.setRawMode(false);
					stdin.pause();
					stdin.off('data', onData);
					stdout.write('\n');
					return resolve(value);
				}
				if (ch === '\u0003') {
					stdin.setRawMode(false);
					return reject(new Error('cancelled'));
				}
				if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
				else value += ch;
			}
		};
		stdin.on('data', onData);
	});
}

async function readPiped() {
	let data = '';
	for await (const chunk of process.stdin) data += chunk;
	return data.split(/\r?\n/)[0];
}

async function main() {
	let password;
	if (process.stdin.isTTY) {
		password = await readHidden('Admin password: ');
		const repeat = await readHidden('Repeat password: ');
		if (password !== repeat) throw new Error('passwords do not match');
	} else {
		password = await readPiped();
	}

	if (password.length < MIN_LENGTH) throw new Error(`password must be at least ${MIN_LENGTH} characters`);

	const hash = await bcrypt.hash(password, COST);
	console.log('\nAdd this line to server/.env:\n');
	console.log(`ADMIN_PANEL_PASSWORD_HASH='${hash}'`);
}

main().catch((err) => {
	console.error(err.message);
	process.exit(1);
});
