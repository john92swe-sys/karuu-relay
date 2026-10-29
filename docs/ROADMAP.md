# Roadmap

## v0.1 — a useful local foundation

- One Chat Completions interface with bounded fallback.
- A dashboard that distinguishes demo fixtures from real requests.
- Local request-attempt caps and metadata-only visibility.
- Company-brief and outreach-draft workflows using caller-supplied text.
- No runtime npm dependencies.

## Next decision: validate a real workflow

Use a small set of non-sensitive public company excerpts with explicitly
configured provider accounts. Record output usefulness, failure rate, latency,
request consumption, and whether a person can use the drafts. Do not equate a
generated draft with outreach or a sale.

## Candidate additions after that evidence

1. A tested adapter for the actual assistant client used by contributors.
2. Provider-specific capability checks and clearer per-provider limits.
3. An optional OS-backed secret store, without exposing keys to the dashboard.
4. Token and monetary budget accounting where the upstream supplies trustworthy
   usage and pricing information.

These are proposed directions, not implemented features or release promises.

