/**
 * Read-only vendor contract probe. Supply the selected instance's credentials
 * through a private environment file, never CLI arguments or committed files.
 * No messages, webhook edits, resets, contact mutations or session changes.
 */
const baseUrl = process.env.UAZAPI_BASE_URL;
const token = process.env.UAZAPI_TOKEN;
const expectedId = process.env.UAZAPI_EXPECTED_INSTANCE_ID;
if (!baseUrl || !token || !expectedId) {
  throw new Error('Require UAZAPI_BASE_URL, UAZAPI_TOKEN and UAZAPI_EXPECTED_INSTANCE_ID');
}
const parsed = new URL(baseUrl);
if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
  throw new Error('Require an HTTPS API base URL without credentials, query or fragment');
}
const root = baseUrl.replace(/\/$/, '');
async function read(path, body) {
  const response = await fetch(`${root}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'error',
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}
// Keep field names and types only; never persist sample message contents.
function fields(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return { type: 'array', count: value.length };
  if (typeof value !== 'object') return typeof value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    item === null ? 'null' : Array.isArray(item) ? 'array' : typeof item,
  ]));
}
try {
  const status = await read('/instance/status');
  const instance = status.instance ?? status;
  if (instance.id !== expectedId) throw new Error('Instance identity mismatch; probe stopped');
  const limits = await read('/instance/wa_messages_limits');
  const webhooks = await read('/webhook');
  const operations = [];
  // These POST endpoints query provider storage; they do not send messages.
  for (const [path, body] of [
    ['/sender/listfolders', undefined],
    ['/chat/find', { limit: 1, offset: 0 }],
    ['/message/find', { limit: 1, offset: 0 }],
  ]) {
    try {
      const payload = await read(path, body);
      operations.push({ path, method: body ? 'POST' : 'GET', fields: fields(payload) });
    } catch {
      operations.push({ path, method: body ? 'POST' : 'GET', failed: true });
    }
  }
  // Output excludes tokens, QR/pairing codes, phone numbers, webhook URLs and payloads.
  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(),
    identityVerified: true,
    state: ['connected', 'connecting', 'disconnected', 'hibernated'].includes(instance.status) ? instance.status : 'unknown',
    limitsContract: {
      hasQuotaObject: typeof limits.new_chat_message_capping === 'object' && limits.new_chat_message_capping !== null,
      hasSendVerdict: typeof limits.can_send_new_messages === 'boolean',
      hasTimelockObject: typeof limits.reachout_timelock === 'object' && limits.reachout_timelock !== null,
    },
    webhookContract: { isArray: Array.isArray(webhooks), count: Array.isArray(webhooks) ? webhooks.length : null },
    operations,
  }, null, 2));
} catch (error) {
  // Do not emit remote bodies or fetch error causes: they may contain credentials/PII.
  console.error(error instanceof Error && /^(\/instance\/|\/webhook: HTTP|Instance identity mismatch)/.test(error.message)
    ? error.message : 'Read-only probe failed; inspect connectivity privately');
  process.exitCode = 1;
}
