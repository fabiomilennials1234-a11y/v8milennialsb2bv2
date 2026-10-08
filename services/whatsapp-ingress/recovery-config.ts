/** Recovery is opt-in separately from durable ingress and scoped to its allowlist. */
export function loadReceiptRecoveryConfig(get: (key: string) => string | undefined, ingress: {
  enabled: boolean; instanceIds: ReadonlySet<string>;
}): { enabled: boolean; instanceIds: string[]; baseUrl: string } {
  const flag = get('INGRESS_RECEIPT_RECOVERY_ENABLED') ?? 'false';
  if (flag !== 'true' && flag !== 'false') throw new Error('Invalid receipt recovery flag');
  if (flag === 'false') return { enabled: false, instanceIds: [], baseUrl: '' };
  const ids = (get('INGRESS_RECEIPT_RECOVERY_INSTANCE_IDS') ?? '').split(',').map(id => id.trim());
  if (!ingress.enabled || !ids.length || ids.some(id => !ingress.instanceIds.has(id))
    || new Set(ids).size !== ids.length) throw new Error('Receipt recovery requires an explicit ingress subset');
  const url = new URL(get('UAZAPI_BASE_URL') ?? '');
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Invalid receipt recovery provider origin');
  }
  return { enabled: true, instanceIds: ids, baseUrl: url.origin };
}
