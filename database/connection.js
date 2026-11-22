import { DatabaseSync } from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
import { config } from '../app/config.js';

pg.types.setTypeParser(20, Number);

function postgres(client) {
  return {
    async all(sql, values = []) {
      let index = 0;
      return (await client.query(sql.replace(/\?/g, () => `$${++index}`), values)).rows;
    },
    async one(sql, values) { return (await this.all(sql, values))[0]; },
    exec(sql) { return client.query(sql); }
  };
}

export async function openDatabase() {
  if (config.production) {
    const pool = new pg.Pool({
      connectionString: config.databaseUrl,
      max: config.poolMax, connectionTimeoutMillis: 3000, idleTimeoutMillis: 30000,
      statement_timeout: 10000, idle_in_transaction_session_timeout: 15000
    });
    pool.on('error', error => console.error('Postgres pool', error));
    return {
      ...postgres(pool),
      async exclusive(fn) {
        const client = await pool.connect();
        try {
          await client.query("SELECT pg_advisory_lock(1093247610)");
          return await fn(postgres(client));
        } finally {
          try { await client.query("SELECT pg_advisory_unlock(1093247610)"); client.release(); }
          catch (error) { client.release(error); }
        }
      },
      close: () => pool.end()
    };
  }

  await mkdir(config.dataDir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(join(config.dataDir, 'development.sqlite'), { timeout: 2000 });
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
  const connection = {
    all(sql, values = []) {
      const stmt = db.prepare(sql);
      return stmt.columns().length ? stmt.all(...values) : (stmt.run(...values), []);
    },
    one(sql, values = []) { return db.prepare(sql).get(...values); },
    exec: sql => db.exec(sql),
    exclusive: fn => fn(connection),
    close: () => db.close()
  };
  return connection;
}
