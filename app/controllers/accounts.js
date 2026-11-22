import { z } from 'zod';
import { email, password, read, text } from '../middleware/validation.js';
import { fail } from '../middleware/errors.js';
import { checkPassword, hashPassword } from '../services/passwords.js';
import { cookie, newSession, sessionHash } from '../models/Account.js';

export function accounts(db, io) {
  return {
    async register(req, res) {
      const input = read(z.object({ email, password, name: text(48) }), req.body);
      const hash = await hashPassword(input.password);
      const row = await db.one(`INSERT INTO users (email, name, password_hash, created_at)
        VALUES (?, ?, ?, ?) ON CONFLICT (email) DO NOTHING RETURNING id`, [input.email, input.name, hash, Date.now()]);
      if (!row) fail(409, 'This email is already in use.');
      res.set('Set-Cookie', await newSession(db, row.id)).status(201).json({ ok: true });
    },
    async login(req, res) {
      const input = read(z.object({ email, password: z.string().min(1).max(128) }), req.body);
      const row = await db.one('SELECT id, password_hash, banned_at FROM users WHERE email = ?', [input.email]);
      if (!await checkPassword(input.password, row?.password_hash)) fail(401, 'Check your email and password.');
      if (row.banned_at) fail(403, 'This account is blocked.');
      res.set('Set-Cookie', await newSession(db, row.id)).json({ ok: true });
    },
    async logout(req, res) {
      const token = sessionHash(req.headers.cookie);
      if (token) {
        await db.all('DELETE FROM sessions WHERE token_hash = ?', [token]);
        io.in(`session:${token}`).disconnectSockets(true);
      }
      res.set('Set-Cookie', cookie('', 0)).json({ ok: true });
    }
  };
}
