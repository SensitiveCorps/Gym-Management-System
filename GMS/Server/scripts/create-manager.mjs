import '../src/config.mjs';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { createPool } from '../src/database.mjs';
import { hashPassword, text } from '../src/security.mjs';
const pool = createPool(process.env.DATABASE_URL);
try {
  const username = text(process.argv[2], 'Username', 60).toLowerCase(),
    name = text(process.argv[3] || username, 'Display name', 150);
  let password;
  if (process.stdin.isTTY) {
    process.stdout.write('New manager password (hidden): ');
    const muted = new Writable({
        write(chunk, encoding, done) {
          done();
        },
      }),
      rl = createInterface({
        input: process.stdin,
        output: muted,
        terminal: true,
      });
    password = await rl.question('');
    rl.close();
    process.stdout.write('\n');
  } else {
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    password = input.replace(/\r?\n$/, '');
  }
  await pool.query(
    "INSERT INTO staff_accounts(username,display_name,password_hash,role) VALUES($1,$2,$3,'MANAGER')",
    [username, name, await hashPassword(password)],
  );
  console.log('Manager account created.');
} finally {
  await pool.end();
}
