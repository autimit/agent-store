import {betterAuth} from 'better-auth';
import {oauthProvider} from '@better-auth/oauth-provider';
import {cimd} from '@better-auth/cimd';
import {fetchClientMetadataResource} from '@better-auth/cimd/node';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync, chmodSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {storeAccountPlugin} from './store-plugin.mjs';

export function createStoreAuth(options = {}) {
  const origin = options.origin || process.env.AGENT_STORE_PUBLIC_ORIGIN || 'http://localhost:8095';
  const directory = options.directory || process.env.AGENT_STORE_AUTH_DIR || resolve('.runtime');
  mkdirSync(directory, {recursive: true, mode: 0o700});
  const secretPath = resolve(process.env.BETTER_AUTH_SECRET_FILE || resolve(directory, 'better-auth.secret'));
  let secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production' && !process.env.BETTER_AUTH_SECRET_FILE) throw new Error('Configure BETTER_AUTH_SECRET or BETTER_AUTH_SECRET_FILE on a persistent volume for production.');
    mkdirSync(dirname(secretPath), {recursive: true, mode: 0o700});
    try {writeFileSync(secretPath, randomBytes(48).toString('base64url'), {flag: 'wx', mode: 0o600});} catch (error) {if (error.code !== 'EEXIST') throw error;}
    secret = readFileSync(secretPath, 'utf8');
    chmodSync(secretPath, 0o600);
  }
  if (secret.length < 32) throw new Error('The authentication secret must contain at least 32 characters.');
  const dbPath = resolve(directory, 'better-auth.db');
  mkdirSync(dirname(dbPath), {recursive: true, mode: 0o700});
  const database = new DatabaseSync(dbPath);
  chmodSync(dbPath, 0o600);
  database.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
  const auth = betterAuth({
    appName: 'Agent Store', baseURL: origin, basePath: '/api/auth', secret, database,
    trustedOrigins: [origin],
    disabledPaths: ['/token'],
    emailAndPassword: {enabled: true, minPasswordLength: 12, maxPasswordLength: 128},
    session: {expiresIn: 86400, cookieCache: {enabled: false}},
    rateLimit: {enabled: true, storage: 'database'},
    advanced: {database: {validateSchema: !options.migrating}, ipAddress: {ipAddressHeaders: ['x-agent-store-client-ip']}},
    plugins: [
      oauthProvider({disableJwtPlugin: true, loginPage: '/conta', consentPage: '/conta/autorizar', scopes: ['offline_access', 'checkouts:read', 'checkouts:write'], grantTypes: ['authorization_code', 'refresh_token'], validAudiences: [origin], accessTokenExpiresIn: 900, refreshTokenExpiresIn: 604800}),
      cimd({fetchClientMetadataResource}),
      storeAccountPlugin(),
    ],
  });
  return {auth, database, origin};
}
