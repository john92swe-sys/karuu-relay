import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.mjs';

// All credentials and company information in this file are invented fixtures.
// Every upstream connection stays on loopback; no provider account is required.
const GATEWAY_KEY = 'test-gateway-key-not-a-production-secret';
const A_KEY = 'test-provider-a-not-a-production-secret';
const B_KEY = 'test-provider-b-not-a-production-secret';

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  if (!server.listening) return;
  const stopped = new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
  server.closeAllConnections();
  await stopped;
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function completion(body, content = 'Fixture completion') {
  return {
    id: 'chatcmpl-local-fixture', object: 'chat.completion', created: 1,
    model: body.model,
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
  };
}

async function upstream(t, handler) {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    try {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const body = raw ? JSON.parse(raw) : {};
      const call = { method: req.method, url: req.url, headers: req.headers, body };
      calls.push(call);
      await handler({ req, res, body, call, calls });
    } catch {
      if (!res.destroyed && !res.headersSent) json(res, 500, { error: { message: 'Fixture failed' } });
      else if (!res.destroyed) res.end();
    }
  });
  const url = await listen(server);
  t.after(() => close(server));
  return { url, calls, server };
}

function provider(id, fixture, extra = {}) {
  return {
    id, label: `Fixture ${id}`, baseUrl: `${fixture.url}/v1`,
    model: `fixture-model-${id}`, apiKey: id === 'a' ? A_KEY : B_KEY,
    enabled: true, supportsTools: true, ...extra,
  };
}

async function app(t, providers, options = {}) {
  const config = {
    gatewayKey: GATEWAY_KEY, demo: false, allowLocalUpstreams: true,
    requestTimeoutMs: 2_000, upstreamTimeoutMs: 500, cooldownMs: 0,
    maxBodyBytes: 32_768,
    profiles: {
      auto: providers.map(p => p.id), research: providers.map(p => p.id),
      writing: providers.map(p => p.id),
    },
    providers, ...(options.config ?? {}),
  };
  const made = await createApp({
    config, clock: options.clock, stateFile: options.stateFile,
    fetchImpl: options.fetchImpl,
  });
  const url = await listen(made.server);
  t.after(() => close(made.server));
  return {
    ...made, url,
    async request(route, body, init = {}) {
      const headers = { authorization: `Bearer ${GATEWAY_KEY}`, ...init.headers };
      if (body !== undefined) headers['content-type'] = 'application/json';
      return fetch(`${url}${route}`, {
        method: body === undefined ? 'GET' : 'POST',
        ...init, headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    },
  };
}

const chat = (extra = {}) => ({
  model: 'auto', messages: [{ role: 'user', content: 'Fixture request' }], ...extra,
});

test('health is public, while model and request endpoints require the gateway key', async t => {
  const up = await upstream(t, ({ res, body }) => json(res, 200, completion(body)));
  const gateway = await app(t, [provider('a', up)]);
  const health = await fetch(`${gateway.url}/healthz`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).demo, false);
  for (const route of ['/v1/models', '/api/status']) {
    const response = await fetch(`${gateway.url}${route}`);
    assert.equal(response.status, 401);
  }
  const denied = await gateway.request('/v1/chat/completions', chat(), {
    headers: { authorization: 'Bearer wrong-test-key' },
  });
  assert.equal(denied.status, 401);
  assert.equal(up.calls.length, 0);
  const models = await gateway.request('/v1/models');
  assert.equal(models.status, 200);
  assert.ok((await models.json()).data.some(model => model.id === 'auto'));
});

test('unknown routes, bad JSON/messages, unknown models and oversized input stay local', async t => {
  const up = await upstream(t, ({ res, body }) => json(res, 200, completion(body)));
  const gateway = await app(t, [provider('a', up)], { config: { maxBodyBytes: 512 } });
  assert.equal((await gateway.request('/v1/not-a-route')).status, 404);
  const badJson = await fetch(`${gateway.url}/v1/chat/completions`, {
    method: 'POST', headers: { authorization: `Bearer ${GATEWAY_KEY}`, 'content-type': 'application/json' },
    body: '{not-json',
  });
  assert.equal(badJson.status, 400);
  for (const body of [{ model: 'auto' }, chat({ messages: [] }), chat({ model: 'unknown-model' })]) {
    assert.equal((await gateway.request('/v1/chat/completions', body)).status, 400);
  }
  const large = await gateway.request('/v1/chat/completions', chat({
    messages: [{ role: 'user', content: 'x'.repeat(1_024) }],
  }));
  assert.equal(large.status, 413);
  assert.equal(up.calls.length, 0);
});

test('429 and 503 use the next provider, its own key, and the configured upstream model', async t => {
  for (const status of [429, 503]) {
    await t.test(`fallback after ${status}`, async sub => {
      const first = await upstream(sub, ({ res }) => json(res, status, { error: { message: 'Fixture unavailable' } }));
      const second = await upstream(sub, ({ res, body }) => json(res, 200, completion(body, 'Backup succeeded')));
      const gateway = await app(sub, [provider('a', first), provider('b', second)]);
      const response = await gateway.request('/v1/chat/completions', chat());
      assert.equal(response.status, 200);
      assert.equal((await response.json()).choices[0].message.content, 'Backup succeeded');
      assert.equal(first.calls.length, 1);
      assert.equal(second.calls.length, 1);
      assert.equal(first.calls[0].headers.authorization, `Bearer ${A_KEY}`);
      assert.equal(second.calls[0].headers.authorization, `Bearer ${B_KEY}`);
      assert.equal(second.calls[0].body.model, 'fixture-model-b');
      assert.equal(second.calls[0].url, '/v1/chat/completions');
      assert.ok(!JSON.stringify([...first.calls, ...second.calls]).includes(GATEWAY_KEY));
    });
  }
});

test('SSE response streams its content and finish marker through the real HTTP adapter', async t => {
  const up = await upstream(t, ({ res, body }) => {
    assert.equal(body.stream, true);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ id: 'stream-fixture', model: body.model, choices: [{ index: 0, delta: { content: 'Streamed fixture' } }] })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
  const gateway = await app(t, [provider('a', up)]);
  const response = await gateway.request('/v1/chat/completions', chat({ stream: true }));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  const content = await response.text();
  assert.match(content, /Streamed fixture/);
  assert.match(content, /data: \[DONE\]/);
});

test('a broken stream never appends a second model after content was delivered', async t => {
  const first = await upstream(t, async ({ res }) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: {"choices":[{"delta":{"content":"FIRST_MODEL_CONTENT"}}]}\n\n');
    await new Promise(resolve => setTimeout(resolve, 70));
    res.destroy();
  });
  const second = await upstream(t, ({ res, body }) => json(res, 200, completion(body, 'SECOND_MODEL_MUST_NOT_APPEAR')));
  const gateway = await app(t, [provider('a', first), provider('b', second)]);
  const response = await gateway.request('/v1/chat/completions', chat({ stream: true }));
  let content = '';
  try {
    for await (const chunk of response.body) content += new TextDecoder().decode(chunk);
  } catch {
    // The downstream may terminate or receive a terminal SSE error; both are valid.
  }
  assert.match(content, /FIRST_MODEL_CONTENT/);
  assert.doesNotMatch(content, /SECOND_MODEL_MUST_NOT_APPEAR/);
  assert.equal(second.calls.length, 0);
});

test('a provider 400 is returned without retrying a different model or echoing raw diagnostics', async t => {
  const first = await upstream(t, ({ res }) => json(res, 400, { error: { message: `PRIVATE_DIAGNOSTIC_${A_KEY}` } }));
  const second = await upstream(t, ({ res, body }) => json(res, 200, completion(body)));
  const gateway = await app(t, [provider('a', first), provider('b', second)]);
  const response = await gateway.request('/v1/chat/completions', chat());
  assert.equal(response.status, 400);
  assert.doesNotMatch(await response.text(), /PRIVATE_DIAGNOSTIC|test-provider-a/);
  assert.equal(first.calls.length, 1);
  assert.equal(second.calls.length, 0);
});

test('failed attempts consume the daily cap and UTC midnight resets the attempt budget', async t => {
  let current = Date.parse('2026-10-29T23:59:00Z');
  const first = await upstream(t, ({ res, body, calls }) => {
    if (calls.length === 1) json(res, 429, { error: { message: 'Initial fixture limit' } });
    else json(res, 200, completion(body, 'New UTC day'));
  });
  const second = await upstream(t, ({ res, body }) => json(res, 200, completion(body, 'Daily budget backup')));
  const gateway = await app(t, [provider('a', first, { requestLimitPerDay: 1 }), provider('b', second)], { clock: () => current });
  assert.equal((await gateway.request('/v1/chat/completions', chat())).status, 200);
  current += 10_000;
  assert.equal((await gateway.request('/v1/chat/completions', chat())).status, 200);
  assert.equal(first.calls.length, 1, 'the failed attempt must exhaust the configured daily cap');
  assert.equal(second.calls.length, 2);
  current = Date.parse('2026-10-30T00:00:01Z');
  const nextDay = await gateway.request('/v1/chat/completions', chat());
  assert.equal(nextDay.status, 200);
  assert.equal((await nextDay.json()).choices[0].message.content, 'New UTC day');
  assert.equal(first.calls.length, 2);
});

test('the daily attempt cap survives a restart when a state file is configured', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'karuu-relay-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const stateFile = path.join(directory, 'usage.json');
  const first = await upstream(t, ({ res, body }) => json(res, 200, completion(body, 'First provider')));
  const second = await upstream(t, ({ res, body }) => json(res, 200, completion(body, 'Persisted cap backup')));
  const providers = [provider('a', first, { requestLimitPerDay: 1 }), provider('b', second)];
  const clock = () => Date.parse('2026-10-29T12:00:00Z');
  const before = await app(t, providers, { clock, stateFile });
  assert.equal((await before.request('/v1/chat/completions', chat())).status, 200);
  await close(before.server);
  const after = await app(t, providers, { clock, stateFile });
  const response = await after.request('/v1/chat/completions', chat());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).choices[0].message.content, 'Persisted cap backup');
  assert.equal(first.calls.length, 1);
});

test('status reports routing metadata without secrets, prompts, or completions', async t => {
  const up = await upstream(t, ({ res, body }) => json(res, 200, completion(body, 'PRIVATE_RESPONSE_FIXTURE')));
  const gateway = await app(t, [provider('a', up)]);
  await (await gateway.request('/v1/chat/completions', chat({
    messages: [{ role: 'user', content: 'PRIVATE_PROMPT_FIXTURE' }],
  }))).text();
  const response = await gateway.request('/api/status');
  assert.equal(response.status, 200);
  const raw = await response.text();
  for (const forbidden of [GATEWAY_KEY, A_KEY, 'PRIVATE_PROMPT_FIXTURE', 'PRIVATE_RESPONSE_FIXTURE']) {
    assert.ok(!raw.includes(forbidden), `status leaked ${forbidden}`);
  }
  const status = JSON.parse(raw);
  assert.equal(status.providers[0].attemptsToday, 1);
  assert.equal(status.providers[0].successes, 1);
  assert.ok(Array.isArray(status.events));
});

test('business workflows retain supplied sources and label outputs as unverified or unsent', async t => {
  const up = await upstream(t, ({ res, body }) => json(res, 200, completion(body, 'Fixture workflow output')));
  const gateway = await app(t, [provider('a', up)]);
  const input = {
    company_name: 'Fictional Fixture Co', website_url: 'https://example.invalid/fixture',
    source_text: 'Fictional Fixture Co sells stainless steel drinkware to promotional-gift distributors.',
    brand: 'JKJ-Plus', product: 'Custom stainless steel drinkware', language: 'English',
  };
  for (const [workflow, expected] of [['company-brief', 'GENERATED_UNVERIFIED'], ['outreach-draft', 'DRAFT_UNSENT']]) {
    const response = await gateway.request(`/v1/workflows/${workflow}`, input);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, expected);
    assert.equal(body.source.type, 'user_supplied');
    assert.equal(body.source.website_url, input.website_url);
    assert.equal(body.result, 'Fixture workflow output');
    assert.equal(body.demo, false);
  }
  assert.equal(up.calls.length, 2);
  for (const call of up.calls) assert.ok(JSON.stringify(call.body.messages).includes(input.source_text));
  const missing = await gateway.request('/v1/workflows/outreach-draft', { company_name: 'No source' });
  assert.equal(missing.status, 400);
  assert.equal(up.calls.length, 2, 'a workflow without source material must not call a model');
});

test('a provider without a configured key is skipped without a network request', async t => {
  const first = await upstream(t, ({ res, body }) => json(res, 200, completion(body)));
  const second = await upstream(t, ({ res, body }) => json(res, 200, completion(body, 'Configured provider')));
  const gateway = await app(t, [
    provider('a', first, { apiKey: undefined, apiKeyEnv: 'KARUU_TEST_INTENTIONALLY_UNSET_PROVIDER_KEY' }),
    provider('b', second),
  ]);
  const response = await gateway.request('/v1/chat/completions', chat());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).choices[0].message.content, 'Configured provider');
  assert.equal(first.calls.length, 0);
});

test('a timed-out upstream uses the backup within the total request budget', async t => {
  const first = await upstream(t, async ({ res, body }) => {
    await new Promise(resolve => setTimeout(resolve, 600));
    if (!res.destroyed) json(res, 200, completion(body, 'Too late'));
  });
  const second = await upstream(t, ({ res, body }) => json(res, 200, completion(body, 'Timeout backup')));
  const gateway = await app(t, [provider('a', first), provider('b', second)], {
    config: { upstreamTimeoutMs: 100, requestTimeoutMs: 1_500 },
  });
  const response = await gateway.request('/v1/chat/completions', chat());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).choices[0].message.content, 'Timeout backup');
  assert.equal(first.calls.length, 1);
  assert.equal(second.calls.length, 1);
});

test('exhausted upstreams return a bounded standard error without leaking provider diagnostics', async t => {
  const first = await upstream(t, ({ res }) => json(res, 503, { error: { message: `PRIVATE_DIAGNOSTIC_${A_KEY}` } }));
  const second = await upstream(t, ({ res }) => json(res, 429, { error: { message: `PRIVATE_DIAGNOSTIC_${B_KEY}` } }));
  const gateway = await app(t, [provider('a', first), provider('b', second)]);
  const response = await gateway.request('/v1/chat/completions', chat());
  assert.equal(response.status, 503);
  const raw = await response.text();
  assert.ok(JSON.parse(raw).error.message);
  for (const forbidden of [A_KEY, B_KEY, 'PRIVATE_DIAGNOSTIC']) assert.ok(!raw.includes(forbidden));
  assert.equal(first.calls.length, 1);
  assert.equal(second.calls.length, 1);
});

test('provider redirects are not followed with credentials; fallback uses its own configured path', async t => {
  const second = await upstream(t, ({ res, body }) => json(res, 200, completion(body, 'Safe backup')));
  const first = await upstream(t, ({ res }) => {
    res.writeHead(307, { location: `${second.url}/redirect-credential-trap` });
    res.end();
  });
  const gateway = await app(t, [provider('a', first), provider('b', second)]);
  const response = await gateway.request('/v1/chat/completions', chat());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).choices[0].message.content, 'Safe backup');
  assert.equal(second.calls.length, 1);
  assert.equal(second.calls[0].url, '/v1/chat/completions');
  assert.equal(second.calls[0].headers.authorization, `Bearer ${B_KEY}`);
});
