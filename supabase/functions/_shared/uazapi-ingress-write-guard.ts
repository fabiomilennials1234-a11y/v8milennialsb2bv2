/**
 * Protects explicitly managed ingress pilot instances from legacy webhook writes.
 * This is a write barrier only: it neither validates routes nor activates ingress.
 * Read the environment for every operation so no mutable process cache is needed.
 */
export class UazapiIngressWriteGuardError extends Error {
  readonly code: 'webhook_route_protected' | 'webhook_route_guard_invalid';
  readonly status: 409 | 503;

  constructor(readonly reason: 'protected_instance' | 'invalid_configuration' | 'invalid_instance_id') {
    super(reason === 'protected_instance'
      ? 'Webhook routing is protected; use the controlled ingress rollout procedure'
      : 'Webhook routing protection is inconclusive; legacy writes are blocked');
    this.name = 'UazapiIngressWriteGuardError';
    this.code = reason === 'protected_instance' ? 'webhook_route_protected' : 'webhook_route_guard_invalid';
    this.status = reason === 'protected_instance' ? 409 : 503;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Call before reserving a policy lease or issuing any webhook mutation. */
export function assertLegacyWebhookWriteAllowed(instanceId: string): void {
  const configured = Deno.env.get('UAZAPI_INGRESS_PROTECTED_INSTANCE_IDS') ?? '';
  if (configured.trim() === '') return;

  const protectedIds = configured.split(',').map(id => id.trim());
  // Never discard malformed entries: a typo must not silently unprotect a pilot.
  if (protectedIds.some(id => !UUID.test(id))) throw new UazapiIngressWriteGuardError('invalid_configuration');
  if (!UUID.test(instanceId)) throw new UazapiIngressWriteGuardError('invalid_instance_id');
  if (protectedIds.some(id => id.toLowerCase() === instanceId.toLowerCase())) {
    throw new UazapiIngressWriteGuardError('protected_instance');
  }
}
