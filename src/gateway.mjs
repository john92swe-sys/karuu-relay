import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { VERSION, normalizeConfig } from './config.mjs';
import { createDemoFetch } from './demo.mjs';

export class GatewayError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

export function validateChat(body, config) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new GatewayError(400, 'invalid_request', 'Request body must be an object.');
  if (typeof body.model !== 'string' || !Object.hasOwn(config.profiles, body.model)) throw new GatewayError(400, 'unknown_model', 'Choose a configured model profile from /v1/models.');
  if (!Array.isArray(body.messages) || !body.messages.length || body.messages.length > 500) throw new GatewayError(400, 'invalid_messages', 'messages must be a nonempty array (maximum 500).');
  const roles = new Set(['system', 'developer', 'user', 'assistant', 'tool']);
  for (const message of body.messages) {
    if (!message || typeof message !== 'object' || !roles.has(message.role)) throw new GatewayError(400, 'invalid_messages', 'Each message needs a supported role.');
    if (typeof message.content !== 'string' && !Array.isArray(message.content) && !(message.role === 'assistant' && message.content == null && Array.isArray(message.tool_calls))) {
      throw new GatewayError(400, 'invalid_messages', 'Message content must be text or a content array; assistant tool calls may have null content.');
    }
    if (Array.isArray(message.content) && message.content.some((part) => !part || typeof part !== 'object' || typeof part.type !== 'string')) throw new GatewayError(400, 'invalid_messages', 'Content parts must be typed objects.');
  }
  if (body.stream !== undefined && typeof body.stream !== 'boolean') throw new GatewayError(400, 'invalid_stream', 'stream must be a boolean.');
  if (body.tools !== undefined && !Array.isArray(body.tools)) throw new GatewayError(400, 'invalid_tools', 'tools must be an array.');
  if (body.n !== undefined && body.n !== 1) throw new GatewayError(400, 'unsupported_n', 'Only n=1 is supported.');
}

function timerController(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), ms);
  timer.unref?.();
  return { controller, clear: () => clearTimeout(timer) };
}

export async function readWithAbort(reader, signal) {
  if (signal.aborted) throw new Error('Request aborted.');
  let abort;
  const stopped = new Promise((_, reject) => {
    abort = () => { void reader.cancel().catch(() => {}); reject(new Error('Request aborted.')); };
    signal.addEventListener('abort', abort, { once: true });
  });
  try { return await Promise.race([reader.read(), stopped]); }
  finally { signal.removeEventListener('abort', abort); }
}

async function readJson(response, maxBytes, signal) {
  if (!response.body) throw new Error('Empty upstream response.');
  const reader = response.body.getReader();
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await readWithAbort(reader, signal);
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error('Upstream response too large.');
      chunks.push(Buffer.from(value));
    }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!data || !Array.isArray(data.choices) || !data.choices.length || !data.choices[0].message) throw new Error('Invalid chat completion.');
    return data;
  } catch (error) { void reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
}

export function createGateway({ config: rawConfig, fetchImpl, clock = Date.now, stateFile } = {}) {
  const config = normalizeConfig(rawConfig);
  const transport = fetchImpl ?? (config.demo ? createDemoFetch() : globalThis.fetch);
  const now = () => { const value = clock(); const ms = value instanceof Date ? value.getTime() : Number(value); if (!Number.isFinite(ms)) throw new Error('Invalid clock.'); return ms; };
  const date = () => new Date(now()).toISOString().slice(0, 10);
  const started = now();
  const blank = () => ({ attemptsToday: 0, successes: 0, errors: 0, lastLatencyMs: null, cooldownUntil: 0 });
  let state = { version: 1, day: date(), providers: {} };
  let inFlight = 0;
  const events = [];
  const providers = new Map(config.providers.map((provider) => [provider.id, provider]));
  if (stateFile && existsSync(stateFile)) {
    let saved;
    try { saved = JSON.parse(readFileSync(stateFile, 'utf8')); }
    catch { throw new Error('Usage state cannot be read. Restore it or review the file before restarting.'); }
    if (saved?.version !== 1 || typeof saved.day !== 'string' || !saved.providers || typeof saved.providers !== 'object') throw new Error('Usage state has an invalid schema.');
    if (saved.day === date()) {
      for (const [id, record] of Object.entries(saved.providers)) {
        if (!providers.has(id)) continue;
        if (!record || ['attemptsToday', 'successes', 'errors'].some((key) => !Number.isSafeInteger(record[key]) || record[key] < 0)) throw new Error('Usage state has invalid counters.');
        state.providers[id] = { ...blank(), attemptsToday: record.attemptsToday, successes: record.successes, errors: record.errors,
          lastLatencyMs: Number.isFinite(record.lastLatencyMs) && record.lastLatencyMs >= 0 ? record.lastLatencyMs : null,
          cooldownUntil: Number.isFinite(record.cooldownUntil) && record.cooldownUntil > 0 ? record.cooldownUntil : 0 };
      }
    }
  }

  function rollover() {
    const day = date();
    if (day !== state.day) state = { version: 1, day, providers: {} };
  }
  function stats(id) { rollover(); return state.providers[id] ??= blank(); }
  function persist() {
    if (!stateFile) return;
    try {
      mkdirSync(dirname(stateFile), { recursive: true });
      const temporary = `${stateFile}.${process.pid}.tmp`;
      writeFileSync(temporary, JSON.stringify(state), { encoding: 'utf8', mode: 0o600 });
      renameSync(temporary, stateFile);
    } catch { throw new GatewayError(503, 'usage_state_unavailable', 'Usage accounting is unavailable; request stopped before further upstream calls.'); }
  }
  function event(provider, type, message, requestId) {
    events.unshift({ time: new Date(now()).toISOString(), provider, type, message, requestId });
    if (events.length > 50) events.pop();
  }
  function availability(provider) {
    const record = stats(provider.id);
    if (!provider.enabled) return 'disabled';
    if (!provider.apiKey) return 'missing_key';
    if (record.attemptsToday >= provider.requestLimitPerDay) return 'daily_limit';
    if (record.cooldownUntil > now()) return 'cooldown';
    return 'ready';
  }
  function status() {
    rollover();
    return {
      version: VERSION, demo: config.demo, day: state.day, uptimeSeconds: Math.max(0, Math.floor((now() - started) / 1000)), inFlight,
      providers: config.providers.map((provider) => ({ id: provider.id, label: provider.label, model: provider.model,
        status: availability(provider), ...stats(provider.id), requestLimitPerDay: provider.requestLimitPerDay })),
      events: events.map((item) => ({ ...item })),
    };
  }
  function models() { return { object: 'list', data: Object.keys(config.profiles).map((id) => ({ id, object: 'model', owned_by: 'karuu-relay' })) }; }

  async function execute(payload, { signal: callerSignal } = {}) {
    validateChat(payload, config);
    if (inFlight >= config.maxConcurrentRequests) throw new GatewayError(429, 'gateway_busy', 'The local gateway is at its concurrency limit.');
    inFlight += 1;
    const requestId = randomUUID();
    const overall = timerController(config.requestTimeoutMs);
    const outerSignal = callerSignal ? AbortSignal.any([overall.controller.signal, callerSignal]) : overall.controller.signal;
    const startedAt = Date.now();
    let released = false;
    function release() { if (!released) { released = true; inFlight -= 1; overall.clear(); } }
    const chain = config.profiles[payload.model];
    try {
      for (const id of chain) {
        if (outerSignal.aborted) break;
        const provider = providers.get(id);
        const ready = availability(provider);
        if (ready !== 'ready') { event(id, 'skipped', ready, requestId); continue; }
        if (payload.tools?.length && !provider.supportsTools) { event(id, 'skipped', 'tools_not_configured', requestId); continue; }
        const record = stats(id);
        record.attemptsToday += 1;
        persist(); // Reserve the attempt before network I/O, including failures.
        event(id, 'attempt', 'upstream_request', requestId);
        const at = Date.now();
        const remaining = config.requestTimeoutMs - (at - startedAt);
        if (remaining <= 0) break;
        const attemptTimer = timerController(Math.max(1, Math.min(config.upstreamTimeoutMs, remaining)));
        const attemptSignal = AbortSignal.any([outerSignal, attemptTimer.controller.signal]);
        let response;
        let streamReader;
        let handedOff = false;
        try {
          response = await transport(`${provider.baseUrl}/chat/completions`, {
            method: 'POST', redirect: 'error', signal: attemptSignal,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.apiKey}` },
            body: JSON.stringify({ ...payload, model: provider.model }),
          });
          if (!response.ok) {
            void response.body?.cancel().catch(() => {});
            const retry = [401, 403, 408, 429].includes(response.status) || response.status >= 500;
            record.errors += 1; record.lastLatencyMs = Date.now() - at;
            if (retry) record.cooldownUntil = now() + config.cooldownMs;
            persist();
            event(id, retry ? 'fallback' : 'error', `upstream_http_${response.status}`, requestId);
            if (retry) continue;
            throw new GatewayError(response.status === 400 ? 400 : 502, 'upstream_rejected_request', 'The upstream rejected this request. Check the message and parameter format; no automatic retry was made.');
          }
          if (payload.stream) {
            if (!response.headers.get('content-type')?.includes('text/event-stream') || !response.body) throw new Error('Invalid streaming response.');
            streamReader = response.body.getReader();
            let first = await readWithAbort(streamReader, attemptSignal);
            while (!first.done && first.value.byteLength === 0) first = await readWithAbort(streamReader, attemptSignal);
            if (first.done) throw new Error('Empty stream.');
            // Only this preflight may fail over. Once this result is returned, the
            // server commits the stream and never switches models mid-response.
            handedOff = true;
            attemptTimer.clear();
            let completed = false;
            const finish = (successful) => {
              if (completed) return;
              completed = true;
              const current = stats(id);
              current.lastLatencyMs = Date.now() - at;
              if (successful) { current.successes += 1; event(id, 'success', 'stream_completed', requestId); }
              else { current.errors += 1; event(id, 'error', 'stream_interrupted', requestId); }
              try { persist(); } finally { release(); }
            };
            return { providerId: id, model: provider.model, requestId, demo: config.demo, reader: streamReader,
              firstChunk: first.value, signal: outerSignal, finish,
              cancel: () => { void streamReader.cancel().catch(() => {}); finish(false); } };
          }
          const result = await readJson(response, config.maxResponseBytes, attemptSignal);
          record.successes += 1; record.lastLatencyMs = Date.now() - at;
          persist(); event(id, 'success', 'completion_received', requestId);
          release();
          return { providerId: id, model: provider.model, requestId, demo: config.demo, result };
        } catch (error) {
          if (error instanceof GatewayError) throw error;
          if (streamReader && !handedOff) void streamReader.cancel().catch(() => {});
          if (callerSignal?.aborted) throw new GatewayError(499, 'client_closed_request', 'The client disconnected.');
          record.errors += 1; record.lastLatencyMs = Date.now() - at;
          record.cooldownUntil = now() + config.cooldownMs;
          persist(); event(id, 'fallback', attemptSignal.aborted ? 'upstream_timeout' : 'upstream_unavailable', requestId);
        } finally { if (!handedOff) attemptTimer.clear(); }
      }
      throw new GatewayError(503, outerSignal.aborted ? 'request_timeout' : 'no_available_provider', outerSignal.aborted ? 'The request time budget was exhausted.' : 'No configured provider could complete the request. Check provider keys, limits and status.');
    } catch (error) { release(); throw error; }
  }

  return { config, status, models, execute };
}
