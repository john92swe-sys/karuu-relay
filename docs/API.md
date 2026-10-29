# API reference — v0.1.0

Default address: `http://127.0.0.1:4319`.
Except for `/healthz` and static dashboard assets, requests require:

```http
Authorization: Bearer <KARUU_GATEWAY_KEY>
Content-Type: application/json
```

The token is the local gateway credential, not an upstream provider key.
The shipped demo accepts `demo-token-not-for-production` on loopback only.

## GET /healthz

```json
{"status":"ok","version":"0.1.0","demo":true}
```

This confirms the process is running. It does not prove a live provider is
reachable or that a model has been called.

## GET /v1/models

Returns configured routing profiles:

```json
{
  "object": "list",
  "data": [{"id":"auto","object":"model","owned_by":"karuu-relay"}]
}
```

Profiles are aliases for ordered provider IDs in `config.json`. They are not
model availability probes. An unknown profile returns HTTP 400.

## POST /v1/chat/completions

```json
{
  "model": "auto",
  "messages": [{"role":"user","content":"Summarize this supplied text…"}],
  "stream": false
}
```

The gateway replaces the profile name with the selected provider's configured
model ID. Other compatible fields are forwarded. Supported messages include
standard system/developer/user/assistant/tool roles; upstream models may support
different subsets. Only `n=1` is supported.

The response body is the selected upstream Chat Completions response. Additional
headers identify the route without revealing credentials:

```http
X-Karuu-Provider: openrouter
X-Karuu-Request-Id: <request UUID>
X-Karuu-Demo: false
```

Set `stream:true` for SSE. Fallback is allowed before the first upstream chunk
has been accepted. After streaming starts, the gateway does not join another
model's output to the response. A detected interruption can produce a terminal
SSE error event with code `stream_interrupted`.

Providers without a configured key, disabled providers, exhausted local daily
budgets, and providers in cooldown are skipped. A request containing `tools`
only uses providers configured with `supportsTools:true`. The gateway does not
execute tools or independently verify model capability.

HTTP 401/403/408/429 and upstream 5xx responses can move to the next provider.
An upstream 400 returns a sanitized error without retry. Connection failures,
timeouts, malformed JSON completions, and empty initial streams can also move
to the next provider. Redirects are not followed.

## POST /v1/workflows/company-brief

## POST /v1/workflows/outreach-draft

Both endpoints accept the same fields:

```json
{
  "company_name": "Example Gift Studio",
  "website_url": "https://gift-studio.example/catalogue",
  "source_text": "Previously collected company text…",
  "brand": "Example Supplier",
  "product": "Confirmed product or cooperation information…",
  "language": "English"
}
```

`source_text` is required. The optional `model` field selects a configured
profile; defaults are `research` for the brief and `writing` for the draft.
The website URL is retained as caller-provided source context and is **never
fetched by these workflows**.

Optional text fields are capped at 2,000 characters each; source text is capped
at 120,000 characters, subject to the total byte limit. These workflows use
ordinary non-streaming requests and return readable text.

Example draft response:

```json
{
  "status": "DRAFT_UNSENT",
  "workflow": "outreach-draft",
  "source": {"type":"user_supplied","website_url":"https://gift-studio.example/catalogue"},
  "result": "Generated draft text…",
  "demo": false,
  "model": "actual-upstream-model-id"
}
```

Company briefs use `GENERATED_UNVERIFIED`. These labels describe review state;
they do not guarantee factual accuracy. There is no email-sending endpoint.

## GET /api/status

Returns `version`, `demo`, `day` (UTC), `uptimeSeconds`, `inFlight`, `providers`,
and up to 50 metadata-only `events`. Events are newest first.

Provider entries include:

- `id`, `label`, and configured `model`.
- `status`: `ready`, `missing_key`, `disabled`, `daily_limit`, or `cooldown`.
- `attemptsToday`, `successes`, `errors`, `lastLatencyMs`, `cooldownUntil`.
- `requestLimitPerDay`.

`ready` means locally eligible to try; it is not a live health assertion.
Counters reset at UTC midnight. CLI real mode persists them in
`data/usage.json`; the demo uses memory only. Failed attempts count toward the
daily cap. The cap is neither a token limit nor a financial spending limit.

Events include time, provider ID, event type, a fixed diagnostic category, and
request ID. Prompt text, completion text, raw upstream diagnostics, and keys
are excluded. Multiple gateway processes must not share the same state file.

## Configuration

| Field | Default | Meaning |
| --- | --- | --- |
| `requestTimeoutMs` | 30000 | Total request budget, including streaming |
| `upstreamTimeoutMs` | 10000 | Per-provider budget before stream handoff |
| `maxBodyBytes` | 262144 | Maximum incoming JSON body |
| `maxResponseBytes` | 4194304 | Maximum upstream response/stream size |
| `maxConcurrentRequests` | 4 | Maximum requests in this process |
| `cooldownMs` | 15000 | Temporary skip after retryable failures |
| `providers[].requestLimitPerDay` | 100 | Local attempts per provider per UTC day |

Real CLI startup reads `.env` and `config.json`. Environment overrides include
`KARUU_CONFIG`, `KARUU_STATE_FILE`, `KARUU_HOST`, and `KARUU_PORT`.
The default host is loopback. Demo mode cannot bind publicly. Real non-loopback
binding requires `KARUU_ALLOW_PUBLIC_BIND=1` and a gateway token of at least 32
characters; this switch does not provide TLS or multi-user security.

For tests, `createApp()` accepts `allowLocalUpstreams:true` in its configuration
to permit HTTP on explicit loopback upstreams. Normal providers use HTTPS.

## Errors

```json
{"error":{"code":"no_available_provider","message":"…","type":"gateway_error"}}
```

Common status codes: 400 invalid input or rejected upstream request, 401 gateway
authentication failure, 404 unsupported endpoint, 413 oversized body, 415 wrong
content type, 429 local concurrency limit, 502 an upstream non-retryable error,
and 503 no available provider or exhausted time/accounting budget.

## Provider references

- [OpenRouter quickstart](https://openrouter.ai/docs/quickstart)
- [OpenRouter free-model limits](https://openrouter.ai/collections/free-models)
- [Groq compatibility documentation](https://console.groq.com/docs/openai)
- [Groq account rate limits](https://console.groq.com/docs/rate-limits)

These references describe the providers' interfaces. They do not replace a live
account check or the user's review of current model availability and billing.

