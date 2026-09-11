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
async function get(path) {
  const response = await fetch(`${root}${path}`, {
    headers: { token },
    redirect: 'error',
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}
try {
  const status = await get('/instance/status');
  const instance = status.instance ?? status;
  if (instance.id !== expectedId) throw new Error('Instance identity mismatch; probe stopped');
  const limits = await get('/instance/wa_messages_limits');
  const webhooks = await get('/webhook');
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
  }, null, 2));
} catch (error) {
  // Do not emit remote bodies or fetch error causes: they may contain credentials/PII.
  console.error(error instanceof Error && /^(\/instance\/|\/webhook: HTTP|Instance identity mismatch)/.test(error.message)
    ? error.message : 'Read-only probe failed; inspect connectivity privately');
  process.exitCode = 1;
}
