import { readFile } from 'node:fs/promises';
import { config } from '../app/config.js';
import { randomBytes } from 'node:crypto';
import { hashPassword } from '../app/services/passwords.js';

async function sql(file) {
  return readFile(new URL(file, import.meta.url), 'utf8');
}

export async function migrate(db) {
  if (!config.production) return db.exec(await sql('./development.sql'));
  const migration = await sql('./migrations/001_initial.sql');
  await db.exclusive(async connection => {
    await connection.exec('CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY)');
    if (await connection.one('SELECT name FROM migrations WHERE name = ?', ['001_initial'])) return;
    await connection.exec('BEGIN');
    try {
      await connection.exec(migration);
      await connection.all('INSERT INTO migrations (name) VALUES (?)', ['001_initial']);
      await connection.exec('COMMIT');
    } catch (error) {
      await connection.exec('ROLLBACK');
      throw error;
    }
  });
}

export async function seed(db) {
  if (config.production) await db.exec(await sql('./production-seed.sql'));
  const head = await db.one('SELECT password_hash FROM users WHERE id = 1');
  if (head?.password_hash) return;
  const email = (config.adminEmail || (config.production ? '' : 'admin@example.test')).trim().toLowerCase();
  const password = config.adminPassword || (config.production ? '' : randomBytes(18).toString('base64url'));
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254 || password.length < 12 || password.length > 128) {
    throw new Error('Set HEAD_ADMIN_EMAIL and a HEAD_ADMIN_PASSWORD of 12 to 128 characters before seeding.');
  }
  const hash = await hashPassword(password);
  const created = await db.one('UPDATE users SET email = ?, password_hash = ? WHERE id = 1 AND password_hash IS NULL RETURNING id', [email, hash]);
  if (created && !config.production && !config.adminPassword) {
    console.info(`Local Head Admin: ${email}\nLocal Head Admin password: ${password}`);
  }
}
