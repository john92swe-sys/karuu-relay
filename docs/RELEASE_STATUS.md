# KARUU Relay 0.1.0 — verification record

**Result: 16 passed, 0 failed, 0 skipped.**

本报告记录已完成的本机 HTTP 集成测试；不代表真实模型服务或 GitHub CI 已验证。

## Completed run

| Field | Recorded evidence |
| --- | --- |
| Evidence recorded at | 2026-10-29T02:13:04.839498+00:00 (UTC), after the completed run |
| Runtime | Node.js v24.22.1 |
| Working directory | Project root, `karuu-relay/` |
| Command | `node --test tests/integration.test.mjs` |
| Tests reported by Node | 16: 14 main scenarios, including a parent scenario with two status-code subtests |
| Passed / failed / skipped | 16 / 0 / 0 |
| Cancelled / todo | 0 / 0 |
| Reported duration | 927.383174 ms |
| Process exit code | 0 |
| Upstreams | Real HTTP fixture servers listening only on loopback |
| Credentials | Invented fixture values only |
| External model calls | None |

The initial attempt in the restricted execution sandbox could not bind a
loopback listener (`listen EPERM 127.0.0.1`). The successful run used approved
execution permissions for local HTTP listeners. No external API request,
provider account, or paid model was used.

This is a summary of the observed test output. A separate raw stdout artifact
was not preserved; none has been reconstructed or represented as an original log.

## Tested behavior

| Area | What the completed test run verified |
| --- | --- |
| Authentication | Health endpoint is public; model, status, and generation endpoints require the gateway key. |
| Request validation | Unknown routes, malformed JSON, missing or empty messages, unknown model profiles, and oversized request bodies are rejected locally. |
| Retryable HTTP failures | A 429 or 503 from the first upstream falls back to the second upstream. |
| Provider isolation | Each upstream receives its own configured key and model; the gateway bearer key is not forwarded. |
| Streaming | SSE content and the completion marker pass through the actual HTTP adapter. |
| Interrupted streaming | A second model is not appended after the first model has delivered stream content. |
| Non-retryable failure | An upstream 400 does not trigger another model; raw private diagnostics are not echoed to the client. |
| Daily accounting | Failed attempts consume the configured daily cap, and the budget resets across UTC midnight. |
| Restart behavior | Daily attempt accounting survives a restart when a state file is configured. |
| Status privacy | Status exposes routing metadata without provider keys, the gateway key, prompts, or completions. |
| Business workflows | Outputs retain the supplied source reference and carry `GENERATED_UNVERIFIED` or `DRAFT_UNSENT`; absent source material is rejected. |
| Missing provider key | An unconfigured provider is skipped without a network request. |
| Timeouts and exhaustion | A timed-out upstream falls back within the request budget; exhausted upstreams produce a bounded standard error. |
| Redirect handling | Upstream redirects are not followed with credentials; fallback uses the next provider's own configured endpoint and key. |

## Exact files associated with this evidence

These SHA-256 values were recorded after the passing run. If relevant code or
test content changes, this record does not establish that the changed version
passes; run the affected verification for that revision.

| File | SHA-256 |
| --- | --- |
| `tests/integration.test.mjs` | `9b0dd694384403e4dda236da1479e1fe313a66eac0dd8c5cfc29877c2f6eb861` |
| `src/server.mjs` | `6c1c1185336e18d0a88dbd83c58e787584099151a6c4d35f5ed13c188fed4f01` |
| `src/gateway.mjs` | `fa4b12b28f0105603a6b013e78a0eed15ddc4f869b16e2847dc3b732babe808b` |
| `src/config.mjs` | `cc2eaa8b7d06e13ee1f3f28a981de692e4c044687067e0128d82dcc7e725dab0` |
| `src/workflows.mjs` | `9e113d08a9fa98fda543827f727037817c9bba3d70965b56d7412724bef4787b` |
| `src/demo.mjs` | `e996f2ea0d36bc191d538b30b3991a9fa78556023ff2854947ef5e69da2cad6b` |

## Boundaries of this record

### Additional release smoke check

The primary agent also started the demo CLI in a bounded local process and
verified `/healthz`, the README JavaScript client, both workflow examples, and
HTTP 200 delivery of the HTML, JavaScript, and CSS assets. `scripts/init.mjs`
created a random private local key and config in a temporary directory; running
it a second time preserved the existing files. The `.env` permission was 0600
in the Linux test environment. These checks made no external model calls.

Dashboard JavaScript passed a syntax check and static element-reference checks.
An independent browser could not reach the transient local service, so rendered
layout and interactive browser behaviour remain unverified. Static asset HTTP
success is not being represented as a browser end-to-end test.

- **No external model call was made.** Provider availability, account limits,
  charges, live model output, and actual cloud credentials were not tested.
- **Node.js 22 was not run.** The completed test execution used Node.js 24.22.1;
  a declared minimum runtime or a CI matrix does not establish a passing run
  under Node.js 22.
- **Browser UI verification is separate and pending in this record.** These
  integration tests do not verify visual layout, clipboard behavior, or browser
  interactions. The primary project agent owns that validation.
- **This record does not establish a completed GitHub Actions run.** Repository
  publication and CI outcomes require their own service receipts.
- The read-only review of configuration, workflow construction, and gateway
  routing found no release-blocking issue in the inspected version. It was a
  focused review, not a comprehensive security audit.

