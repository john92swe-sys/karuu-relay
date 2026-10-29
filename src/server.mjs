import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGateway, GatewayError, readWithAbort } from './gateway.mjs';
import { buildWorkflow } from './workflows.mjs';
import { loadConfig, isLoopback, VERSION } from './config.mjs';

const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), '../public');
const STATIC = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/dashboard', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
]);

function writeJson(res, status, data) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function authenticated(req, key) {
  const actual = req.headers.authorization;
  if (typeof actual !== 'string' || actual.length > 1100) return false;
  const expected = Buffer.from(`Bearer ${key}`);
  const candidate = Buffer.from(actual);
  return expected.length === candidate.length && timingSafeEqual(expected, candidate);
}

function jsonBody(req, maxBytes) {
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
    req.resume();
    throw new GatewayError(415, 'unsupported_media_type', 'Send Content-Type: application/json.');
  }
  if (Number(req.headers['content-length'] || 0) > maxBytes) {
    req.resume();
    throw new GatewayError(413, 'body_too_large', 'Request body is too large.');
  }
  return new Promise((resolveBody, reject) => {
    let size = 0;
    let settled = false;
    const chunks = [];
    const fail = (error) => { if (!settled) { settled = true; chunks.length = 0; reject(error); } };
    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBytes) return fail(new GatewayError(413, 'body_too_large', 'Request body is too large.'));
      chunks.push(chunk);
    });
    req.on('error', () => fail(new GatewayError(400, 'invalid_body', 'Unable to read request body.')));
    req.on('aborted', () => fail(new GatewayError(400, 'request_aborted', 'Request body was interrupted.')));
    req.on('end', () => {
      if (settled) return;
      settled = true;
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
        resolveBody(body);
      } catch { reject(new GatewayError(400, 'invalid_json', 'Request body must be a JSON object.')); }
    });
  });
}

async function writeChunk(res, chunk) {
  if (res.destroyed) throw new Error('Client disconnected.');
  if (res.write(chunk)) return;
  await new Promise((resolveDrain, reject) => {
    const cleanup = () => { res.off('drain', drained); res.off('close', closed); };
    const drained = () => { cleanup(); resolveDrain(); };
    const closed = () => { cleanup(); reject(new Error('Client disconnected.')); };
    res.once('drain', drained); res.once('close', closed);
  });
}

async function streamToClient(res, completion, maxBytes) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  let bytes = completion.firstChunk.byteLength;
  try {
    if (bytes > maxBytes) throw new Error('Stream too large.');
    await writeChunk(res, completion.firstChunk);
    while (true) {
      const { done, value } = await readWithAbort(completion.reader, completion.signal);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error('Stream too large.');
      await writeChunk(res, value);
    }
    completion.finish(true);
    res.end();
  } catch {
    // The stream is already committed. Report a terminal event, never restart
    // against a different model or expose the upstream error body.
    try { completion.cancel(); } catch { /* accounting failure is not exposed */ }
    if (!res.destroyed && !res.writableEnded) {
      res.end(`event: error\ndata: ${JSON.stringify({ error: { code: 'stream_interrupted', message: 'The upstream stream ended unexpectedly; no model switch was made.' } })}\n\n`);
    }
  } finally { try { completion.reader.releaseLock(); } catch { /* disconnected */ } }
}

export async function createApp({ config, fetchImpl, clock, stateFile } = {}) {
  const gateway = createGateway({ config: config ?? loadConfig(), fetchImpl, clock, stateFile });
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const cancelled = new AbortController();
    res.on('close', () => { if (!res.writableEnded) cancelled.abort(); });
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/healthz') return writeJson(res, 200, { status: 'ok', version: VERSION, demo: gateway.config.demo });
      const asset = req.method === 'GET' && STATIC.get(url.pathname);
      if (asset) {
        try {
          const content = await readFile(resolve(PUBLIC, asset[0]));
          res.writeHead(200, { 'Content-Type': asset[1] }); res.end(content);
        } catch { writeJson(res, 404, { error: { code: 'dashboard_unavailable', message: 'Dashboard files are missing.' } }); }
        return;
      }
      if (!authenticated(req, gateway.config.gatewayKey)) {
        req.resume(); res.setHeader('WWW-Authenticate', 'Bearer');
        throw new GatewayError(401, 'unauthorized', 'A valid gateway Bearer token is required.');
      }
      if (req.method === 'GET' && url.pathname === '/v1/models') return writeJson(res, 200, gateway.models());
      if (req.method === 'GET' && url.pathname === '/api/status') return writeJson(res, 200, gateway.status());
      if (req.method !== 'POST') throw new GatewayError(404, 'not_found', 'Endpoint not found.');
      if (url.pathname !== '/v1/chat/completions' && !['/v1/workflows/company-brief', '/v1/workflows/outreach-draft'].includes(url.pathname)) throw new GatewayError(404, 'not_found', 'Endpoint not found.');
      const body = await jsonBody(req, gateway.config.maxBodyBytes);
      const workflowName = url.pathname.startsWith('/v1/workflows/') ? url.pathname.split('/').at(-1) : null;
      const workflow = workflowName ? buildWorkflow(workflowName, body) : null;
      const completion = await gateway.execute(workflow ? workflow.payload : body, { signal: cancelled.signal });
      res.setHeader('X-Karuu-Provider', completion.providerId);
      res.setHeader('X-Karuu-Request-Id', completion.requestId);
      res.setHeader('X-Karuu-Demo', String(completion.demo));
      if (completion.reader) return await streamToClient(res, completion, gateway.config.maxResponseBytes);
      if (workflow) {
        return writeJson(res, 200, { status: workflow.status, workflow: workflowName, source: workflow.source,
          result: completion.result.choices[0].message.content ?? '', demo: completion.demo, model: completion.model });
      }
      writeJson(res, 200, completion.result);
    } catch (error) {
      if (res.headersSent || res.destroyed || res.writableEnded) return;
      const known = error instanceof GatewayError;
      const status = known ? error.status : 500;
      writeJson(res, status, { error: { code: known ? error.code : 'internal_error', message: known ? error.message : 'The local gateway could not complete this request.', type: status < 500 ? 'invalid_request_error' : 'gateway_error' } });
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  return { server, gateway };
}

async function main() {
  const demo = process.argv.includes('--demo');
  const config = loadConfig({ demo });
  const host = process.env.KARUU_HOST || '127.0.0.1';
  if (!isLoopback(host) && (demo || process.env.KARUU_ALLOW_PUBLIC_BIND !== '1' || config.gatewayKey.length < 32)) {
    throw new Error('Public binding requires real mode, a 32-character key and KARUU_ALLOW_PUBLIC_BIND=1. Use a TLS reverse proxy.');
  }
  const port = Number(process.env.KARUU_PORT || 4319);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('KARUU_PORT must be 1–65535.');
  const stateFile = demo ? undefined : resolve(process.env.KARUU_STATE_FILE || 'data/usage.json');
  const { server } = await createApp({ config, stateFile });
  await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(port, host, resolveListen); });
  const address = host.includes(':') ? `[${host}]` : host;
  console.log(`KARUU Relay ${VERSION} · ${demo ? 'DEMO — simulated providers only' : 'REAL — your configured provider accounts'} · http://${address}:${port}`);
  console.log(demo ? 'No real model or provider key is used in demo mode.' : 'Gateway key is in your local .env. Never upload that file.');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { server.close(); server.closeAllConnections(); });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(`KARUU Relay could not start: ${error.message}`); process.exitCode = 1; });
}
