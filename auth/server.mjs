import {createServer} from 'node:http';
import {toNodeHandler} from 'better-auth/node';
import {getMigrations} from 'better-auth/db/migration';
import {createStoreAuth} from './config.mjs';

const {auth, database, origin} = createStoreAuth({migrating: process.argv.includes('--migrate')});
if (process.argv.includes('--migrate')) {
  const migrations = await getMigrations(auth.options);
  await migrations.runMigrations();
  database.close();
  console.log('Better Auth: migrations applied to the local authentication database.');
} else {
  await auth.$context;
  const handler = toNodeHandler(auth);
  const server = createServer((req, res) => {
    if (req.url === '/healthz') {res.writeHead(200, {'Content-Type': 'application/json'}); res.end('{"status":"ok","auth":"better-auth"}'); return;}
    void handler(req, res).catch(() => {if (!res.headersSent) res.writeHead(500, {'Content-Type': 'application/json'}); res.end('{"error":"auth_unavailable"}');});
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.listen(Number(process.env.AGENT_STORE_AUTH_PORT || 8096), '127.0.0.1', () => console.log(`Better Auth ready for ${origin}; listening on loopback.`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => {database.close(); process.exit(0);}));
}
