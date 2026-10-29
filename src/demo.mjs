// An in-memory transport, not an LLM. It performs no network calls.
export function createDemoFetch() {
  return async (url, options) => {
    if (String(url).includes('demo-busy.invalid')) {
      return new Response(JSON.stringify({ error: { message: 'DEMO simulated rate limit' } }), { status: 429, headers: { 'Content-Type': 'application/json' } });
    }
    const body = JSON.parse(options.body);
    const system = String(body.messages?.[0]?.content || '');
    let content = '[DEMO · no real model called] Provider A was unavailable; the request reached simulated provider B. Add your own provider keys to use real models.';
    if (system.includes('KARUU_COMPANY_BRIEF')) {
      content = '[DEMO · no real model called]\nCompany brief example\n- Evidence: use only the source text supplied by the operator.\n- Product fit: requires a real model and manual review.\n- Unknown: current buying intent, procurement contact, MOQ and budget.\nThis is a fixed demonstration, not research on the submitted company.';
    }
    if (system.includes('KARUU_OUTREACH_DRAFT')) {
      content = '[DEMO · no real model called · UNSENT]\nSubject: Product sourcing discussion\n\nHi [Name],\nWe are exploring whether our product range fits your business. May I send a short selection for your review?\n\nBest regards,\n[Sender]\n\nFixed demonstration text. Replace it with a source-grounded draft before use.';
    }
    const response = { id: 'chatcmpl-demo', object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: 'demo-b', choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }, demo: true };
    if (!body.stream) return new Response(JSON.stringify(response), { headers: { 'Content-Type': 'application/json' } });
    const chunks = [
      { id: response.id, object: 'chat.completion.chunk', model: 'demo-b', choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }], demo: true },
      { id: response.id, object: 'chat.completion.chunk', model: 'demo-b', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], demo: true },
    ];
    return new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  };
}
