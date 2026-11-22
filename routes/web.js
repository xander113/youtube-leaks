import express from 'express';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../app/config.js';

const frontend = fileURLToPath(new URL('../frontend/', import.meta.url));

export async function webRoutes(app, server) {
  if (config.production) {
    const dist = join(frontend, 'dist');
    const index = await readFile(join(dist, 'index.html'), 'utf8');
    app.use('/assets', express.static(join(dist, 'assets'), { immutable: true, maxAge: '1y', fallthrough: false }));
    app.get('/{*page}', (req, res, next) => {
      if (!req.accepts('html')) return next();
      res.set('Cache-Control', 'no-cache').type('html').send(index);
    });
    return async () => {};
  }

  const { createServer } = await import('vite');
  const vite = await createServer({
    configFile: fileURLToPath(new URL('../vite.config.js', import.meta.url)),
    server: {
      middlewareMode: { server },
      fs: { strict: true, allow: [frontend, join(dirname(frontend.replace(/\/$/, '')), 'node_modules')] },
      ws: { server, path: '/__vite-hmr' }
    },
    appType: 'custom'
  });
  app.use(vite.middlewares);
  app.get('/{*page}', async (req, res, next) => {
    if (!req.accepts('html')) return next();
    try {
      const template = await readFile(join(frontend, 'index.html'), 'utf8');
      res.set('Cache-Control', 'no-store').type('html').send(await vite.transformIndexHtml(req.originalUrl, template));
    } catch (error) {
      vite.ssrFixStacktrace(error);
      throw error;
    }
  });
  return () => vite.close();
}
