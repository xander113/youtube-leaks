import { z } from 'zod';
import { fail } from './errors.js';

export function read(schema, input) {
  const result = schema.safeParse(input);
  if (!result.success) {
    const message = result.error.issues.map(issue => `${issue.path.join('.') || 'Value'}: ${issue.message}`).join(' | ');
    fail(400, message);
  }
  return result.data;
}

export const text = max => z.string().trim().min(1, 'Enter a value.').max(max);
export const key = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, 'Invalid ID.');
export const kind = z.enum(['clip', 'series']);
export const email = z.email().trim().toLowerCase().max(254);
export const flag = z.boolean().default(false);
export const password = z.string().min(12).max(128);
export const id = z.coerce.number().int().positive().max(2147483647);
export const settingsSchema = z.object({ paid: z.boolean() });
