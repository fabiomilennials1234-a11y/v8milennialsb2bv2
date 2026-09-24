export interface IngressConfig {
  enabled: boolean;
  accepting: boolean;
  instanceIds: ReadonlySet<string>;
  port: number;
  maxRequests: number;
  maxBackgroundTasks: number;
  bodyTimeoutMs: number;
  shutdownTimeoutMs: number;
}

export function loadConfig(get: (key: string) => string | undefined): IngressConfig {
  const enabled = get('INGRESS_ENABLED') === 'true';
  const admission = get('INGRESS_ACCEPTING') ?? 'true';
  if (admission !== 'true' && admission !== 'false') throw new Error('Invalid configuration: INGRESS_ACCEPTING');
  const instanceIds = new Set((get('INGRESS_INSTANCE_IDS') ?? '').split(',').map(s => s.trim()).filter(Boolean));
  for (const id of instanceIds) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
      throw new Error('INGRESS_INSTANCE_IDS must contain database instance UUIDs');
    }
  }
  if (enabled) {
    if (get('INGRESS_SINGLE_WORKER_CONFIRMED') !== 'true') throw new Error('Canary requires confirmed single-worker deployment');
    if (!instanceIds.size) throw new Error('Enabled ingress requires a nonempty instance allowlist');
    for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'UAZAPI_WEBHOOK_SECRET', 'INGRESS_ALLOWED_NET']) {
      if (!get(key)?.trim()) throw new Error(`Missing required configuration: ${key}`);
    }
    const url = new URL(get('SUPABASE_URL')!);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('SUPABASE_URL must be an HTTPS origin');
  }
  const number = (key: string, fallback: number, max: number) => {
    const value = Number(get(key) ?? fallback);
    if (!Number.isInteger(value) || value < 1 || value > max) throw new Error(`Invalid configuration: ${key}`);
    return value;
  };
  return {
    enabled, accepting: admission === 'true', instanceIds,
    port: number('PORT', 8080, 65535),
    maxRequests: number('INGRESS_MAX_REQUESTS', 32, 128),
    maxBackgroundTasks: number('INGRESS_MAX_BACKGROUND_TASKS', 128, 1024),
    bodyTimeoutMs: number('INGRESS_BODY_TIMEOUT_MS', 10000, 30000),
    shutdownTimeoutMs: number('INGRESS_SHUTDOWN_TIMEOUT_MS', 45000, 120000),
  };
}
