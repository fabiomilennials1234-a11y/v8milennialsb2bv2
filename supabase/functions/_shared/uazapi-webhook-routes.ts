/**
 * Read-only preflight for an instance's messages_update split. No provider writes.
 * Contract: https://docs.uazapi.com/openapi-bundled.json, GET/POST /webhook,
 * GET /globalwebhook and Webhook schema (consulted 2026-09-24).
 * IDs are opaque. Missing defaults are inconclusive, never inferred.
 * Plans contain secret-bearing URLs: keep in trusted memory; never log/serialize.
 * Two provider writes are NOT atomic: this does not authorize cutover, guarantee
 * no overlap/gap, prove retries, or coordinate the existing rebind writers.
 */
export interface UazapiWebhookRoute {
  readonly id: string;
  readonly enabled: boolean;
  readonly url: string;
  readonly events: readonly string[];
  readonly excludeMessages: readonly string[];
  readonly addUrlEvents: boolean;
  readonly addUrlTypesMessages: boolean;
}

type Result<T> = { ok: true; value: T } | { ok: false; reason: string };
const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });
const fields = ['id', 'enabled', 'url', 'events', 'excludeMessages', 'addUrlEvents', 'addUrlTypesMessages'];
const managedEvents = ['messages', 'messages_update', 'connection'];
const supportedEvents = ['connection', 'history', 'messages', 'messages_update', 'newsletter_messages', 'call',
  'contacts', 'presence', 'groups', 'labels', 'chats', 'chat_labels', 'sender'];
const supportedExclusions = ['wasSentByApi', 'wasNotSentByApi', 'fromMeYes', 'fromMeNo', 'isGroupYes', 'isGroupNo'];
const stringSet = (value: unknown): value is string[] => Array.isArray(value)
  && value.every(v => typeof v === 'string' && v.length > 0 && v.trim() === v)
  && new Set(value).size === value.length;
const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every(v => b.includes(v));
function httpsUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim() !== value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash;
  } catch { return false; }
}

/** Global GET may return one object; local GET must return the full array. */
export function parseUazapiWebhookRoutes(raw: unknown, scope: 'instance' | 'global' = 'instance'): Result<UazapiWebhookRoute[]> {
  const nodes = scope === 'global' && raw && typeof raw === 'object' && !Array.isArray(raw) ? [raw] : raw;
  if (!Array.isArray(nodes)) return fail('routes_unreadable');
  const routes: UazapiWebhookRoute[] = [];
  const ids = new Set<string>();
  for (const node of nodes) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return fail('route_unreadable');
    const data = node as Record<string, unknown>;
    // Unknown fields could affect delivery; do not silently drop provider extensions.
    if (Object.keys(data).some(key => !fields.includes(key))) return fail('route_unknown_fields');
    if (typeof data.id !== 'string' || !data.id || data.id.trim() !== data.id) return fail('route_id_missing');
    if (ids.has(data.id)) return fail('route_id_duplicate');
    if (!httpsUrl(data.url) || typeof data.enabled !== 'boolean'
      || !stringSet(data.events) || !stringSet(data.excludeMessages)
      || typeof data.addUrlEvents !== 'boolean' || typeof data.addUrlTypesMessages !== 'boolean') return fail('route_config_inconclusive');
    if (data.events.some(event => !supportedEvents.includes(event))
      || data.excludeMessages.some(filter => !supportedExclusions.includes(filter))
      || (data.enabled && data.events.length === 0)) return fail('route_policy_unknown');
    ids.add(data.id);
    routes.push({ id: data.id, url: data.url, enabled: data.enabled, events: [...data.events],
      excludeMessages: [...data.excludeMessages], addUrlEvents: data.addUrlEvents, addUrlTypesMessages: data.addUrlTypesMessages });
  }
  return { ok: true, value: routes };
}

export interface UazapiUpdatesSplitPlan {
  readonly routesBefore: readonly UazapiWebhookRoute[];
  readonly globalsBefore: readonly UazapiWebhookRoute[];
  readonly desired: {
    /** Existing route IDs are preserved; unrelated routes are unchanged. */
    readonly existingRoutes: readonly UazapiWebhookRoute[];
    /** Provider allocates this ID. Never invent or retry an uncertain add. */
    readonly addedRoute: Omit<UazapiWebhookRoute, 'id'>;
  };
  readonly sourceId: string;
}

export function planUazapiUpdatesSplit(input: {
  instanceRoutes: unknown;
  globalRoutes: unknown;
  expectedSourceUrl: string;
  ingressUrl: string;
}): Result<UazapiUpdatesSplitPlan> {
  if (!httpsUrl(input.expectedSourceUrl) || !httpsUrl(input.ingressUrl)
    || new URL(input.expectedSourceUrl).href === new URL(input.ingressUrl).href) return fail('destination_invalid');
  const local = parseUazapiWebhookRoutes(input.instanceRoutes);
  if (!local.ok) return local;
  const global = parseUazapiWebhookRoutes(input.globalRoutes, 'global');
  if (!global.ok) return global;
  // Require explicit inspection even if a global route seems unrelated.
  if (global.value.some(route => route.enabled)) return fail('global_route_active');
  const sources = local.value.filter(route => route.url === input.expectedSourceUrl);
  if (sources.length !== 1) return fail('source_not_unique');
  const source = sources[0];
  if (!source.enabled || !sameSet(source.events, managedEvents)
    || !source.addUrlEvents || source.addUrlTypesMessages) return fail('source_policy_unexpected');
  if (local.value.some(route => new URL(route.url).href === new URL(input.ingressUrl).href)) return fail('destination_already_present');
  if (local.value.some(route => route.id !== source.id && route.enabled
    && route.events.some(event => managedEvents.includes(event)))) return fail('instance_event_overlap');
  const { id: _id, ...config } = source;
  return { ok: true, value: {
    routesBefore: local.value,
    globalsBefore: global.value,
    sourceId: source.id,
    desired: {
      existingRoutes: local.value.map(route => route.id === source.id ? { ...route, events: ['messages', 'connection'] } : route),
      addedRoute: { ...config, url: input.ingressUrl, events: ['messages_update'] },
    },
  } };
}

function sameRoute(a: UazapiWebhookRoute, b: UazapiWebhookRoute): boolean {
  return a.id === b.id && a.url === b.url && a.enabled === b.enabled
    && a.addUrlEvents === b.addUrlEvents && a.addUrlTypesMessages === b.addUrlTypesMessages
    && sameSet(a.events, b.events) && sameSet(a.excludeMessages, b.excludeMessages);
}
function sameRoutes(actual: readonly UazapiWebhookRoute[], expected: readonly UazapiWebhookRoute[]): boolean {
  return actual.length === expected.length && expected.every(route => actual.some(item => sameRoute(item, route)));
}

/** Confirms configuration only; not delivery, queue health, or cutover safety. */
export function verifyUazapiUpdatesSplitReadback(
  plan: UazapiUpdatesSplitPlan, instanceRoutes: unknown, globalRoutes: unknown,
): Result<{ addedRouteId: string }> {
  const local = parseUazapiWebhookRoutes(instanceRoutes);
  if (!local.ok) return local;
  const global = parseUazapiWebhookRoutes(globalRoutes, 'global');
  if (!global.ok) return global;
  if (!sameRoutes(global.value, plan.globalsBefore)) return fail('global_routes_changed');
  const additions = local.value.filter(route => !plan.routesBefore.some(old => old.id === route.id));
  if (additions.length !== 1) return fail('added_route_not_unique');
  const added = additions[0];
  if (!sameRoutes(local.value, [...plan.desired.existingRoutes, { ...plan.desired.addedRoute, id: added.id }])) {
    return fail('split_readback_mismatch');
  }
  return { ok: true, value: { addedRouteId: added.id } };
}
