// Demo client. Set KARUU_GATEWAY_KEY for your real local gateway.
const baseUrl = process.env.KARUU_BASE_URL || 'http://127.0.0.1:4319';
const token = process.env.KARUU_GATEWAY_KEY || 'demo-token-not-for-production';
const response = await fetch(`${baseUrl}/v1/chat/completions`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify({
    model: 'auto',
    messages: [{ role: 'user', content: 'Write a brief introduction for a reusable bottle supplier. Do not invent certifications or prices.' }],
  }),
});
const result = await response.json();
if (!response.ok) {
  console.error(`Gateway returned HTTP ${response.status}: ${result.error?.message || 'Request failed'}`);
  process.exitCode = 1;
} else {
  console.log(result.choices?.[0]?.message?.content || JSON.stringify(result, null, 2));
}

