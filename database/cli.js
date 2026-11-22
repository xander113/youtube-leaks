import { config } from '../app/config.js';
import { migrate, seed } from './bootstrap.js';
import { openDatabase } from './connection.js';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';

const command = process.argv[2];
if (!['migrate', 'seed', 'refresh'].includes(command)) throw new Error('Choose migrate, seed, or refresh.');
if (command === 'refresh') {
  if (config.production) throw new Error('Refresh is available in development only.');
  for (const suffix of ['', '-wal', '-shm']) {
    await rm(join(config.dataDir, 'development.sqlite' + suffix), { force: true });
  }
}
const db = await openDatabase();
try {
  if (command !== 'seed') await migrate(db);
  if (command !== 'migrate') await seed(db);
  console.info(`Database ${command} complete.`);
} finally {
  await db.close();
}
