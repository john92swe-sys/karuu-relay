import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export const VERSION = '0.1.0';
export const DEMO_KEY = 'demo-token-not-for-production';
const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/;
export const isLoopback = (host) => ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host);

function integer(value, fallback, min = 0, max = 2 ** 31 - 1) {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < min || result > max) throw new Error('Configuration contains an invalid numeric limit.');
  return result;
}

export function normalizeConfig(input = {}) {
  const gatewayKey = input.gatewayKey || (input.demo ? DEMO_KEY : '');
  if (typeof gatewayKey !== 'string' || gatewayKey.length < 1 || gatewayKey.length > 1024) throw new Error('Set KARUU_GATEWAY_KEY before starting.');
  const requestTimeoutMs = integer(input.requestTimeoutMs, 30000, 1, 300000);
  const providers = (input.providers ?? []).map((provider) => {
    if (!SAFE_ID.test(provider.id ?? '') || typeof provider.model !== 'string' || !provider.model.trim()) throw new Error('Each provider needs an id and model.');
    const url = new URL(provider.baseUrl);
    if (url.username || url.password || url.search || url.hash) throw new Error('Provider URLs must not contain credentials, query strings or fragments.');
    if (url.protocol !== 'https:' && !(input.allowLocalUpstreams === true && url.protocol === 'http:' && isLoopback(url.hostname))) {
      throw new Error('Use HTTPS upstreams. Loopback HTTP is only allowed with allowLocalUpstreams.');
    }
    const apiKey = provider.apiKey ?? (provider.apiKeyEnv ? process.env[provider.apiKeyEnv] : undefined) ?? '';
    return {
      id: provider.id,
      label: String(provider.label || provider.id).slice(0, 120),
      baseUrl: url.toString().replace(/\/$/, ''),
      model: provider.model,
      apiKey: String(apiKey),
      enabled: provider.enabled !== false,
      supportsTools: provider.supportsTools === true,
      requestLimitPerDay: integer(provider.requestLimitPerDay, 100, 0),
    };
  });
  if (new Set(providers.map((p) => p.id)).size !== providers.length) throw new Error('Provider ids must be unique.');
  const profiles = input.profiles ?? { auto: providers.map((p) => p.id) };
  if (!profiles || typeof profiles !== 'object' || Array.isArray(profiles)) throw new Error('profiles must be an object.');
  const known = new Set(providers.map((p) => p.id));
  for (const [name, ids] of Object.entries(profiles)) {
    if (!SAFE_ID.test(name) || !Array.isArray(ids) || ids.some((id) => !known.has(id)) || ids.length > 20 || new Set(ids).size !== ids.length) {
      throw new Error('Each profile must list unique configured provider ids (at most 20).');
    }
  }
  return {
    gatewayKey,
    demo: input.demo === true,
    requestTimeoutMs,
    upstreamTimeoutMs: integer(input.upstreamTimeoutMs, Math.min(10000, requestTimeoutMs), 1, requestTimeoutMs),
    maxBodyBytes: integer(input.maxBodyBytes, 262144, 1, 2097152),
    maxResponseBytes: integer(input.maxResponseBytes, 4194304, 1, 16777216),
    maxConcurrentRequests: integer(input.maxConcurrentRequests, 4, 1, 32),
    cooldownMs: integer(input.cooldownMs, 15000, 0, 3600000),
    providers,
    profiles: Object.fromEntries(Object.entries(profiles).map(([key, value]) => [key, [...value]])),
  };
}

export function demoConfig() {
  return {
    gatewayKey: DEMO_KEY, demo: true,
    profiles: { auto: ['demo-busy', 'demo-ready'], research: ['demo-busy', 'demo-ready'], writing: ['demo-busy', 'demo-ready'] },
    providers: [
      { id: 'demo-busy', label: 'Demo provider A · simulated 429', baseUrl: 'https://demo-busy.invalid/v1', model: 'demo-a', apiKey: 'demo-only', requestLimitPerDay: 1000 },
      { id: 'demo-ready', label: 'Demo provider B · simulated success', baseUrl: 'https://demo-ready.invalid/v1', model: 'demo-b', apiKey: 'demo-only', requestLimitPerDay: 1000, supportsTools: true },
    ],
  };
}

export function loadConfig({ demo = false } = {}) {
  if (demo) return demoConfig();
  const envFile = resolve('.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const configFile = resolve(process.env.KARUU_CONFIG || 'config.json');
  if (!existsSync(configFile)) throw new Error('No config.json. Run npm run init, add your provider keys, or use npm run demo.');
  const input = JSON.parse(readFileSync(configFile, 'utf8'));
  const gatewayKey = process.env.KARUU_GATEWAY_KEY;
  if (!gatewayKey || gatewayKey.length < 24 || gatewayKey === 'replace-with-a-long-random-local-key' || gatewayKey === DEMO_KEY) {
    throw new Error('Real mode needs a private KARUU_GATEWAY_KEY of at least 24 characters. Run npm run init.');
  }
  return { ...input, gatewayKey, demo: false };
}
