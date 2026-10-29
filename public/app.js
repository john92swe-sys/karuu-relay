'use strict';

(() => {
  const $ = (id) => document.getElementById(id);
  const state = { token: '', connected: false, demo: false, task: 'chat', running: false, output: '', profile: 'auto', controller: null };
  const els = {
    token: $('gateway-token'), connect: $('connect-button'), connection: $('connection-badge'), connectionLabel: $('connection-label'),
    global: $('global-message'), run: $('run-button'), runLabel: $('run-label'), runHelp: $('run-help'),
    models: $('model-profile'), providerGrid: $('provider-grid'), providerCount: $('provider-count'),
    activity: $('activity-list'), output: $('result-output'), resultStatus: $('result-status'),
    placeholder: $('result-placeholder'), resultError: $('result-error'), timing: $('result-timing'), copy: $('copy-button')
  };

  function node(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined && text !== null) el.textContent = String(text);
    return el;
  }

  function redact(value) {
    let text = String(value ?? '');
    if (state.token) text = text.split(state.token).join('[redacted]');
    return text.replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [redacted]').replace(/\b(?:sk-|gsk_|freellmapi-)[a-zA-Z0-9_-]{12,}\b/g, '[redacted]');
  }

  function message(text = '', isError = true) {
    els.global.textContent = text;
    els.global.hidden = !text;
    els.global.className = `notice ${isError ? 'error-notice' : 'demo-notice'}`;
  }

  function setDemoMode(demo) {
    state.demo = demo;
    $('demo-badge').hidden = !demo;
    $('demo-notice').hidden = !demo;
  }

  function setConnection(connected) {
    state.connected = connected;
    els.connection.classList.toggle('connected', connected);
    els.connectionLabel.textContent = connected ? (state.demo ? 'Demo connected' : 'Connected') : 'Not connected';
    els.connect.textContent = connected ? 'Reconnect' : 'Connect →';
    $('refresh-button').disabled = !connected || state.running;
    els.models.disabled = !connected || state.running;
    els.run.disabled = !connected || state.running;
    els.runHelp.textContent = connected ? (state.demo ? 'Sample output · no cloud call.' : 'Uses your configured provider allowance.') : 'Connect your gateway to begin.';
  }

  async function request(path, { method = 'GET', body, timeout = 65000, auth = true } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const headers = { Accept: 'application/json' };
    if (auth) headers.Authorization = `Bearer ${state.token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    try {
      const response = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal, credentials: 'omit', cache: 'no-store' });
      let data;
      try { data = await response.json(); } catch { data = {}; }
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setConnection(false);
          throw new Error('The gateway key was not accepted. Check the key in your local configuration.');
        }
        const messages = {
          400: 'The request was not accepted. Check the required fields and selected profile.',
          404: 'This endpoint or routing profile is unavailable in the running gateway.',
          413: 'This request is too large. Shorten the source text and try again.',
          429: 'The available route has reached a request limit. Wait or select another configured profile.',
          502: 'The upstream model could not complete the request. Check provider status.',
          503: 'No configured provider could complete this request. Check keys, allowance, and provider status.',
          504: 'The model did not respond within the time limit. Try a shorter request or another profile.'
        };
        throw new Error(messages[response.status] || `The gateway returned HTTP ${response.status}. Check its local status and try again.`);
      }
      return data;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('The request timed out. Check gateway status before trying again.');
      if (error instanceof TypeError) throw new Error('Could not reach the gateway. Keep it running and try again.');
      throw error;
    } finally { clearTimeout(timer); }
  }

  function numeric(...values) {
    for (const value of values) if (typeof value === 'number' && Number.isFinite(value)) return value;
    return null;
  }

  function providerStatus(provider) {
    const status = String(provider.status ?? provider.state ?? '').toLowerCase();
    if (provider.enabled === false || status === 'disabled') return ['Disabled', ''];
    if (provider.configured === false || provider.hasKey === false || /missing|not.configured|no.key|unconfigured/.test(status)) return ['Not configured', ''];
    if (/limit|exhaust|quota/.test(status)) return ['At limit', 'warning'];
    if (/cooldown|rate.limit/.test(status) || Number(provider.cooldownUntil ?? provider.cooldown_until ?? 0) > Date.now()) return ['Cooldown', 'warning'];
    if (/error|unavailable|failed|invalid/.test(status)) return ['Unavailable', 'error'];
    if (/ready|available|active|healthy/.test(status) || provider.configured === true || provider.hasKey === true) return ['Ready', 'ready'];
    return ['Not checked', ''];
  }

  function renderProviders(data) {
    const list = Array.isArray(data.providers) ? data.providers : Array.isArray(data.data?.providers) ? data.data.providers : [];
    els.providerCount.textContent = String(list.length);
    els.providerGrid.replaceChildren();
    if (!list.length) { els.providerGrid.append(node('div', 'provider-empty', 'No provider details were returned. Configure a provider and refresh.')); return; }
    for (const provider of list) {
      const title = String(provider.label ?? provider.name ?? provider.id ?? 'Provider');
      const card = node('article', 'provider-card');
      const top = node('div', 'provider-top');
      const identity = node('div', 'provider-identity');
      identity.append(node('span', 'provider-symbol', title.slice(0, 2).toUpperCase()));
      const name = node('div'); name.append(node('div', 'provider-name', title));
      const model = node('span', 'provider-model', provider.model ?? provider.modelId ?? 'Configured upstream');
      model.title = model.textContent; name.append(model); identity.append(name);
      const [label, style] = providerStatus(provider);
      const status = node('span', `provider-status ${style}`); status.append(node('span', 'small-dot'), document.createTextNode(label));
      top.append(identity, status); card.append(top);
      const usage = provider.usage ?? provider.stats ?? {};
      const attempts = numeric(provider.attemptsToday, provider.attempts_today, provider.requestsToday, provider.requests_today, provider.attempts, usage.attemptsToday, usage.attempts, usage.requests);
      const successes = numeric(provider.successes, provider.successesToday, usage.successes);
      const latency = numeric(provider.lastLatencyMs, provider.latencyMs, usage.lastLatencyMs, usage.latencyMs);
      const metrics = node('div', 'provider-metrics');
      for (const [metricName, value, small] of [['Attempts today', attempts === null ? '—' : attempts, false], ['Successes', successes === null ? '—' : successes, false], ['Last response', latency === null ? '—' : `${Math.round(latency)} ms`, true]]) {
        const metric = node('div', 'provider-metric'); metric.append(node('span', 'provider-metric-label', metricName), node('span', `provider-metric-value${small ? ' small' : ''}`, value)); metrics.append(metric);
      }
      card.append(metrics); els.providerGrid.append(card);
    }
  }

  function formatTime(value) {
    const date = new Date(value ?? Date.now());
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function renderActivity(data) {
    const list = data.events ?? data.recentEvents ?? data.recent_events ?? [];
    els.activity.replaceChildren();
    if (!Array.isArray(list) || !list.length) { els.activity.append(node('p', 'activity-empty', 'Your routing events will appear after a request.')); return; }
    for (const event of list.slice(0, 8)) {
      const row = node('div', 'activity-row');
      const kind = event.type ?? event.event ?? event.status ?? 'Request';
      const status = event.httpStatus ?? event.statusCode ?? event.upstreamStatus;
      const description = event.message ?? event.reason ?? (status ? `Upstream returned HTTP ${status}` : String(kind).replaceAll('_', ' '));
      row.append(node('span', 'activity-time', formatTime(event.time ?? event.timestamp ?? event.at)), node('span', 'activity-provider', event.provider ?? event.providerId ?? event.provider_id ?? 'Gateway'), node('span', 'activity-message', redact(description).slice(0, 260)), node('span', 'activity-type', kind));
      els.activity.append(row);
    }
  }

  async function refreshStatus() {
    const status = await request('/api/status', { timeout: 10000 });
    renderProviders(status); renderActivity(status);
    return status;
  }

  function renderModels(data) {
    const entries = Array.isArray(data.data) ? data.data : Array.isArray(data.models) ? data.models : [];
    const previous = els.models.value || 'auto';
    els.models.replaceChildren();
    for (const model of entries) {
      const id = typeof model === 'string' ? model : model.id;
      if (!id) continue;
      const option = node('option', '', String(id)); option.value = String(id); els.models.append(option);
    }
    if (!els.models.options.length) { const option = node('option', '', 'auto'); option.value = 'auto'; els.models.append(option); }
    const available = [...els.models.options].map(option => option.value);
    els.models.value = available.includes(previous) ? previous : available[0];
  }

  async function connect() {
    state.token = els.token.value.trim();
    if (!state.token) { message('Enter your gateway key to connect.'); els.token.focus(); return; }
    els.connect.disabled = true; els.connect.textContent = 'Connecting…'; message();
    try {
      const [status, models] = await Promise.all([request('/api/status', { timeout: 10000 }), request('/v1/models', { timeout: 10000 })]);
      setDemoMode(status.demo === true || status.mode === 'demo');
      renderProviders(status); renderActivity(status); renderModels(models); setConnection(true);
    } catch (error) { setConnection(false); message(error.message); }
    finally { els.connect.disabled = false; }
  }

  function chooseTask(task) {
    if (state.running) return;
    state.task = task;
    document.querySelectorAll('.task-tab').forEach(tab => { const selected = tab.dataset.task === task; tab.classList.toggle('selected', selected); tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1; });
    $('chat-fields').hidden = task !== 'chat'; $('business-fields').hidden = task === 'chat';
    for (const panel of [$('chat-fields'), $('business-fields')]) {
      panel.querySelectorAll('input, textarea, select').forEach(field => { field.disabled = panel.hidden; });
    }
    $('business-fields').setAttribute('aria-labelledby', `tab-${task}`);
    els.runLabel.textContent = task === 'chat' ? 'Run request' : task === 'company-brief' ? 'Create brief' : 'Create draft';
    const preferred = task === 'outreach-draft' ? 'writing' : task === 'company-brief' ? 'research' : 'auto';
    if ([...els.models.options].some(option => option.value === preferred)) els.models.value = preferred;
  }

  function setBusy(busy) {
    state.running = busy;
    document.body.classList.toggle('busy', busy);
    els.run.disabled = busy || !state.connected; els.models.disabled = busy || !state.connected;
    els.connect.disabled = busy; $('refresh-button').disabled = busy || !state.connected; $('sample-button').disabled = busy;
    document.querySelectorAll('.task-tab').forEach(tab => { tab.disabled = busy; });
    if (busy) els.runLabel.textContent = 'Working…';
    else chooseTask(state.task);
  }

  function outputText(data) {
    const candidates = [data.choices?.[0]?.message?.content, data.completion?.choices?.[0]?.message?.content, data.result?.choices?.[0]?.message?.content, data.output, data.content, data.text, data.result, data.draft, data.brief];
    for (const candidate of candidates) {
      if (typeof candidate === 'string') return candidate;
      if (Array.isArray(candidate)) return candidate.map(item => typeof item === 'string' ? item : item.text ?? JSON.stringify(item)).join('\n');
      if (candidate && typeof candidate === 'object') return JSON.stringify(candidate, null, 2);
    }
    return JSON.stringify(data, null, 2);
  }

  async function runTask(event) {
    event.preventDefault();
    if (!state.connected || state.running) return;
    let path = '/v1/chat/completions';
    let body;
    if (state.task === 'chat') {
      const prompt = $('chat-prompt').value.trim();
      if (!prompt) { $('chat-prompt').focus(); message('Add a message before running a request.'); return; }
      body = { model: els.models.value, messages: [{ role: 'user', content: prompt }], stream: false };
    } else {
      const source = $('source-text').value.trim();
      if (!source) { $('source-text').focus(); message('Paste the source text for this task. The gateway does not fetch the website.'); return; }
      const company = $('company-name').value.trim();
      if (!company) { $('company-name').focus(); message('Add the company name for this draft.'); return; }
      path = `/v1/workflows/${state.task}`;
      body = { model: els.models.value, company_name: company, website_url: $('website-url').value.trim(), source_text: source, brand: $('brand').value.trim(), product: $('product').value.trim(), language: $('language').value };
    }
    message(); setBusy(true); state.output = ''; els.copy.disabled = true;
    els.placeholder.hidden = true; els.output.hidden = true; els.resultError.hidden = true; els.timing.textContent = '';
    els.resultStatus.textContent = state.demo ? 'RUNNING DEMO' : 'REQUEST IN PROGRESS'; els.resultStatus.className = 'badge neutral';
    const start = performance.now();
    try {
      const data = await request(path, { method: 'POST', body });
      state.output = outputText(data); els.output.textContent = state.output; els.output.hidden = false; els.copy.disabled = !state.output;
      const status = state.task === 'outreach-draft' ? 'DRAFT · NOT SENT' : state.task === 'company-brief' ? 'GENERATED · VERIFY FACTS' : 'RESPONSE RECEIVED';
      els.resultStatus.textContent = state.demo ? `DEMO · ${status}` : status;
      els.resultStatus.className = state.demo ? 'badge demo' : 'badge success';
      els.timing.textContent = `${((performance.now() - start) / 1000).toFixed(1)} s`;
      $('result-footnote').textContent = state.demo ? 'Simulated output. No real model was called and no email was sent.' : state.task === 'outreach-draft' ? 'This is a draft only. Verify facts, recipient, and commitments before sending.' : 'Generated content may be inaccurate. Check facts and commitments.';
    } catch (error) {
      els.resultError.textContent = error.message; els.resultError.hidden = false;
      els.resultStatus.textContent = 'REQUEST NOT COMPLETED'; els.resultStatus.className = 'badge error';
      els.timing.textContent = `${((performance.now() - start) / 1000).toFixed(1)} s`;
    } finally {
      setBusy(false);
      if (state.connected) { try { await refreshStatus(); } catch { message('The request is finished, but provider status could not be refreshed.'); } }
    }
  }

  function fillSample() {
    if (state.task === 'chat') $('chat-prompt').value = 'Create a short checklist for reviewing a B2B outreach draft. Include factual accuracy, a relevant product match, a clear question, and unknown information. Do not invent a price or delivery promise.';
    else {
      $('company-name').value = 'Acme Fitness (fictional sample)';
      $('website-url').value = 'https://example.com';
      $('source-text').value = 'FICTIONAL SAMPLE FOR DEMONSTRATION. Acme Fitness is an independent activewear brand. Its example website describes women’s leggings, sports bras, and studio accessories. It sells its own branded collections online. This sample contains no evidence of a current purchasing project, an approved supplier process, order volumes, or a named purchasing contact.';
      $('brand').value = 'KARUU'; $('product').value = 'Explore a possible private-label activewear cooperation. No price, minimum order, certification, or delivery date has been confirmed.';
      $('language').value = 'English';
    }
    message('Fictional sample filled in. Select Run / Create when you are ready.', false);
  }

  async function copyResult() {
    if (!state.output) return;
    let copied = false;
    try { await navigator.clipboard.writeText(state.output); copied = true; } catch {
      const area = node('textarea'); area.value = state.output; area.setAttribute('readonly', ''); area.style.position = 'fixed'; area.style.left = '-10000px'; document.body.append(area); area.select();
      try { copied = document.execCommand('copy'); } catch { copied = false; }
      area.remove();
    }
    $('copy-feedback').textContent = copied ? 'Result copied.' : 'Copy was unavailable. Select the result text to copy it manually.';
    els.copy.title = copied ? 'Copied' : 'Select text to copy';
    if (!copied) message('Clipboard access is unavailable. Select the result text and copy it manually.', false);
  }

  $('connection-form').addEventListener('submit', event => { event.preventDefault(); connect(); });
  $('toggle-token').addEventListener('click', () => { const show = els.token.type === 'password'; els.token.type = show ? 'text' : 'password'; $('toggle-token').textContent = show ? 'Hide' : 'Show'; $('toggle-token').setAttribute('aria-label', show ? 'Hide gateway key' : 'Show gateway key'); });
  els.token.addEventListener('input', () => { if (state.connected && els.token.value.trim() !== state.token) setConnection(false); });
  $('refresh-button').addEventListener('click', async () => { $('refresh-button').disabled = true; try { await refreshStatus(); message(); } catch (error) { message(error.message); } finally { $('refresh-button').disabled = !state.connected || state.running; } });
  document.querySelectorAll('.task-tab').forEach(tab => tab.addEventListener('click', () => chooseTask(tab.dataset.task)));
  document.querySelector('.task-tabs').addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || state.running) return;
    const tabs = [...document.querySelectorAll('.task-tab')]; const index = tabs.indexOf(document.activeElement);
    if (index < 0) return;
    event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    chooseTask(tabs[next].dataset.task); tabs[next].focus();
  });
  $('task-form').addEventListener('submit', runTask); $('sample-button').addEventListener('click', fillSample); els.copy.addEventListener('click', copyResult);

  async function initialize() {
    try {
      const health = await request('/healthz', { auth: false, timeout: 8000 });
      setDemoMode(health.demo === true || health.mode === 'demo');
      if (state.demo) { els.token.value = 'demo-token-not-for-production'; await connect(); }
    } catch (error) { message(error.message); }
  }
  chooseTask(state.task);
  initialize();
})();
