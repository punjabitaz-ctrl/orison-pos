'use strict';

const path = require('path');
const fastify = require('fastify')({
  logger: { level: process.env.LOG_LEVEL || 'info' },
});

const { initDb, DB_PATH } = require('./db');
const { authPlugin } = require('./routes');

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';

async function start() {
  const db = initDb();
  fastify.decorate('db', db);

  await fastify.register(authPlugin);

  // Serve the PWA statically (public/). Anything not under /api => index.html.
  await fastify.register(require('@fastify/static'), {
    root: path.join(__dirname, '..', 'public'),
    prefix: '/',
  });
  fastify.setNotFoundHandler((req, reply) => {
    if (req.raw.url.startsWith('/api/')) {
      return reply.code(404).send({ error: 'Not found' });
    }
    return reply.sendFile('index.html');
  });

  try {
    await fastify.listen({ port: PORT, host: HOST });
    fastify.log.info(`Orison POS server listening on http://${HOST}:${PORT}`);
    fastify.log.info(`SQLite database at ${DB_PATH}`);
    console.log('');
    console.log('  LAN clients point their browser at  http://<this-machine-ip>:' + PORT);
    console.log('  First run auto-seeds the demo catalog (see server/seed.js).');
    console.log('');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

// Auto-seed on first boot so the PWA has data out of the box.
const { seed } = require('./seed');
seed();

start();