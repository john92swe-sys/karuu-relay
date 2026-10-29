# KARUU Relay

**One local API for your models, with visible fallbacks and practical B2B workflows.**

[简体中文](README.zh-CN.md) · [API](docs/API.md) · [Release status](docs/RELEASE_STATUS.md) · [MIT license](LICENSE)

KARUU Relay is a small, self-hosted, bring-your-own-key gateway for
OpenAI-compatible chat-completion providers. Route requests through an ordered
provider profile, move to a fallback when an upstream is unavailable, and see
what happened in a local dashboard.

It also includes two source-text workflows: a company brief and an outreach
draft. They are useful starting points for B2B research assistants that already
have company evidence. Generated drafts remain **UNSENT**.

Version **0.1.0** is an early, single-user release. The included demo and tests
use simulated providers. Live provider accounts have not been validated as part
of this release; see [release status](docs/RELEASE_STATUS.md).

## Try the local demo

Requires **Node.js 22 or newer**. No npm dependencies need to be installed.

```sh
npm run demo
```

Open **http://127.0.0.1:4319**. On Windows you can double-click
`start-demo.cmd` after installing Node.js.

The demo gateway token is `demo-token-not-for-production`. The dashboard fills
it in when demo mode is active. Click Connect, choose a sample, and run it.

The first simulated provider returns HTTP 429; the second returns clearly
labelled demo content. **No cloud model is called and no real API key is
required.** Demo content is a fixture, not a language-model result.

## Use your own providers

```sh
node scripts/init.mjs
```

This creates a local `.env` containing a random gateway token and a local
`config.json`, without replacing existing files. Add your provider keys to
`.env`, then check the model IDs and provider order in `config.json`.

```sh
npm start
```

Open the same local address and enter `KARUU_GATEWAY_KEY` from your own `.env`
into the dashboard's token field. The dashboard keeps this value in memory,
not in browser storage. Provider keys stay on the server and are never
returned by the status API.

The example configuration contains OpenRouter and Groq endpoints. It is a
configuration example, not a guarantee that a selected model remains free,
available, or appropriate for your use. Set limits in each provider's own
console and select the model you intend to use.

## Included

| Capability | v0.1.0 scope |
| --- | --- |
| Chat API | `POST /v1/chat/completions`, ordinary JSON and SSE streaming |
| Model aliases | Configured profiles such as `auto`, `research`, and `writing` |
| Fallbacks | Bounded attempts on rate limits, upstream failures, and timeouts |
| Daily request caps | Local attempt accounting, including failed attempts |
| Dashboard | Provider state, counters, and limited metadata-only events |
| Company brief | Analysis of text supplied by the caller |
| Outreach draft | A draft based on supplied source text and product information |
| Deployment | Local Node.js process, localhost by default |

The gateway does not execute model tool calls. It can pass compatible tool-call
messages through to eligible providers; the client remains responsible for
executing any tools. It does not supply browsing, email delivery, CRM access,
or computer control.

## Call the API

While the demo is running:

```sh
curl http://127.0.0.1:4319/v1/chat/completions \
  -H 'Authorization: Bearer demo-token-not-for-production' \
  -H 'Content-Type: application/json' \
  -d '{"model":"auto","messages":[{"role":"user","content":"Write a short introduction."}]}'
```

For a dependency-free JavaScript example:

```sh
node examples/chat.mjs
```

For a company brief:

```sh
curl http://127.0.0.1:4319/v1/workflows/company-brief \
  -H 'Authorization: Bearer demo-token-not-for-production' \
  -H 'Content-Type: application/json' \
  --data-binary @examples/company-brief.json
```

On Windows PowerShell use `curl.exe` when `curl` resolves to a PowerShell alias.
See [API documentation](docs/API.md) for the endpoint contract.

## Connect an existing assistant

If your application supports an OpenAI-compatible **Chat Completions** endpoint,
set its base URL to `http://127.0.0.1:4319/v1`, use your gateway token, and select
one of the returned model aliases. Check the client's expected API first.

This release does **not** implement Anthropic Messages or OpenAI Responses.
Do not assume a client that requires those protocols will work by changing
only its base URL. Client-specific integrations, including DeepSeek Harness,
have not been tested in this release.

## Development

```sh
npm run check
npm test
```

Tests run against local fixtures without provider keys. They exercise gateway
behaviour rather than claiming access to a live provider. The CI workflow runs
on Node.js 22 and 24.

## Operational boundaries

- This gateway manages credentials you provide; it does not issue provider
  accounts, create free quota, or remove upstream rate limits.
- The daily cap counts attempts, not money or tokens. It is not a billing cap.
- Credentials are environment variables or a local `.env` file. This release
  does not include an encrypted key vault; protect the host and `.env` file.
- The process is designed for one trusted local user. Do not expose it directly
  to the public internet.
- Source text and prompts are sent to the selected upstream provider. Review
  that provider's data-handling and permitted-use terms before supplying data.
- Automatic retries may consume more than one upstream request. A stream that
  has already started is not silently continued with a different model.
- Status events omit prompt text, completion text, raw upstream error bodies,
  and keys. Configured labels/model IDs are operational metadata.

## Origins

Built by KARUU AB. Inspired in part by the public FreeLLMAPI project; this is an
independently written, narrower implementation. See
[acknowledgements](THIRD_PARTY_NOTICES.md) and [roadmap](docs/ROADMAP.md).

