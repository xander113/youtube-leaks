import Redis from 'ioredis';
import { createAdapter } from '@socket.io/redis-adapter';
import { config } from '../config.js';

export async function attachRedis(io) {
  const settings = { lazyConnect: true, connectTimeout: 2000, commandTimeout: 1500, maxRetriesPerRequest: 1, enableOfflineQueue: false };
  const commands = new Redis(config.redisUrl, settings);
  const publish = commands.duplicate();
  const subscribe = commands.duplicate();
  const clients = [commands, publish, subscribe];
  for (const client of clients) client.on('error', error => {
    if (config.production) console.error('Redis', error.message);
  });
  try {
    await Promise.all(clients.map(client => client.connect()));
    io.adapter(createAdapter(publish, subscribe, { publishOnSpecificResponseChannel: true }));
  } catch (error) {
    if (config.production) {
      clients.forEach(client => client.disconnect());
      throw error;
    }
    await Promise.allSettled(clients.map(async client => client.disconnect()));
    console.info('Local Redis is offline. Using single-process rate limits and live updates.');
    return { commands: null, close() {} };
  }
  return { commands, close: () => clients.forEach(client => client.disconnect()) };
}
