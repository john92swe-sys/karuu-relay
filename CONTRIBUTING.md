# Contributing

Start with `npm run demo`, then run `npm run check` and `npm test`.
Node.js 22+ is required; the project has no runtime npm dependencies.

For a new provider, prefer a configuration entry when its Chat Completions
protocol is compatible. Add code only when a documented behaviour requires it.
Link to the provider's official documentation and distinguish a free allowance,
a trial, and a paid plan. Never commit working API keys.

For routing changes, include a local fixture test for the changed behaviour.
Protect the streaming boundary: once a response begins, the gateway must not
splice output from a second model into it. Failed attempts count toward a
configured request cap.

For workflows, keep source evidence separate from generated inferences. Do not
add email sending or external write actions to a research/draft endpoint.

For UI changes, render user and model text with textContent, maintain keyboard
navigation, and preserve the clear demo indicator.

Keep claims in the README aligned with tests and live evidence. A mock passing
does not demonstrate upstream service availability.

