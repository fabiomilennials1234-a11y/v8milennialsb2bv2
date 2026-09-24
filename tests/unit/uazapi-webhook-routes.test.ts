import { describe, expect, it } from 'vitest';
import { parseUazapiWebhookRoutes, planUazapiUpdatesSplit, verifyUazapiUpdatesSplitReadback } from '../../supabase/functions/_shared/uazapi-webhook-routes';

const source = {
  id: 'wh_opaque-source', enabled: true, url: 'https://edge.example.invalid/webhook/test-secret',
  events: ['messages', 'messages_update', 'connection'], excludeMessages: ['wasSentByApi', 'isGroupYes'],
  addUrlEvents: true, addUrlTypesMessages: false,
};
const ingressUrl = 'https://ingress.example.invalid/webhook/test-secret';
const unrelated = { ...source, id: 'wh_third-party', url: 'https://other.example.invalid/events', events: ['presence'], addUrlEvents: false };
const globals = [{ ...unrelated, id: 'wh_global', enabled: false }];
const input = () => ({ instanceRoutes: [structuredClone(source), structuredClone(unrelated)], globalRoutes: structuredClone(globals), expectedSourceUrl: source.url, ingressUrl });
function plan() {
  const result = planUazapiUpdatesSplit(input());
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}
function readback() {
  const p = plan();
  return { p, routes: [...p.desired.existingRoutes, { ...p.desired.addedRoute, id: 'wh_provider-generated' }] };
}

describe('strict Uazapi route inventory', () => {
  it('keeps every supported field and opaque IDs, copying input arrays', () => {
    const raw = input().instanceRoutes;
    const result = parseUazapiWebhookRoutes(raw);
    expect(result).toEqual({ ok: true, value: raw });
    raw[0].events.push('call');
    if (result.ok) expect(result.value[0].events).not.toContain('call');
  });
  it('accepts the documented global singleton, not a local singleton', () => {
    expect(parseUazapiWebhookRoutes(globals[0], 'global').ok).toBe(true);
    expect(parseUazapiWebhookRoutes(source).ok).toBe(false);
  });
  it.each([
    null, {}, { data: [source] }, [null], [{ ...source, id: undefined }],
    [{ ...source, id: '' }], [source, source], [{ ...source, events: ['messages', 'messages'] }],
    [{ ...source, enabled: undefined }], [{ ...source, addUrlEvents: undefined }],
    [{ ...source, addUrlTypesMessages: undefined }], [{ ...source, excludeMessages: undefined }],
    [{ ...source, events: [] }], [{ ...source, events: ['*'] }], [{ ...source, excludeMessages: ['unknown'] }],
    [{ ...source, unknownDeliveryFlag: true }], [{ ...source, url: 'https://user:password@example.invalid' }],
  ])('rejects incomplete or ambiguous inventory %#', raw => {
    const result = parseUazapiWebhookRoutes(raw);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('test-secret');
    expect(JSON.stringify(result)).not.toContain('password');
  });
});

describe('read-only updates split preflight', () => {
  it('preserves unrelated routes and filters, separating only update events', () => {
    const data = input();
    const before = structuredClone(data);
    const result = planUazapiUpdatesSplit(data);
    expect(data).toEqual(before);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.routesBefore).toEqual(data.instanceRoutes);
    expect(result.value.desired.existingRoutes).toEqual([{ ...source, events: ['messages', 'connection'] }, unrelated]);
    expect(result.value.desired.addedRoute).toEqual({ enabled: true, url: ingressUrl, events: ['messages_update'], excludeMessages: source.excludeMessages, addUrlEvents: true, addUrlTypesMessages: false });
  });
  it('requires explicit global inspection and blocks every active global route', () => {
    expect(planUazapiUpdatesSplit({ ...input(), globalRoutes: null }).ok).toBe(false);
    expect(planUazapiUpdatesSplit({ ...input(), globalRoutes: [{ ...globals[0], enabled: true }] })).toEqual({ ok: false, reason: 'global_route_active' });
  });
  it.each(['messages', 'messages_update', 'connection'])('blocks another active subscriber to %s', event => {
    const data = input();
    data.instanceRoutes[1].events = [event];
    expect(planUazapiUpdatesSplit(data)).toEqual({ ok: false, reason: 'instance_event_overlap' });
  });
  it.each([
    { enabled: false }, { events: ['messages', 'connection'] }, { events: [...source.events, 'call'] },
    { addUrlEvents: false }, { addUrlTypesMessages: true },
  ])('rejects unexpected source policy %#', changes => {
    expect(planUazapiUpdatesSplit({ ...input(), instanceRoutes: [{ ...source, ...changes }] }).ok).toBe(false);
  });
  it('requires a unique exact source URL and an unused distinct destination', () => {
    expect(planUazapiUpdatesSplit({ ...input(), expectedSourceUrl: source.url + '/other' }).ok).toBe(false);
    expect(planUazapiUpdatesSplit({ ...input(), instanceRoutes: [source, { ...source, id: 'other-id', enabled: false }] }).ok).toBe(false);
    expect(planUazapiUpdatesSplit({ ...input(), ingressUrl: source.url }).ok).toBe(false);
    expect(planUazapiUpdatesSplit({ ...input(), ingressUrl: unrelated.url }).ok).toBe(false);
  });
});

describe('all-routes split readback', () => {
  it('accepts exact resulting coverage regardless of list/set ordering', () => {
    const { p, routes } = readback();
    routes[0] = { ...routes[0], events: ['connection', 'messages'] };
    expect(verifyUazapiUpdatesSplitReadback(p, routes.reverse(), globals)).toEqual({ ok: true, value: { addedRouteId: 'wh_provider-generated' } });
  });
  it('rejects legacy configuration and partially applied split', () => {
    const { p, routes } = readback();
    expect(verifyUazapiUpdatesSplitReadback(p, p.routesBefore, globals).ok).toBe(false);
    expect(verifyUazapiUpdatesSplitReadback(p, [source, ...routes.slice(1)], globals).ok).toBe(false);
    expect(verifyUazapiUpdatesSplitReadback(p, routes.slice(0, -1), globals).ok).toBe(false);
  });
  it.each(['url', 'enabled', 'events', 'excludeMessages', 'addUrlEvents', 'addUrlTypesMessages'] as const)('detects changed %s on unrelated routes', field => {
    const { p, routes } = readback();
    const changes = { url: ingressUrl, enabled: false, events: ['call'], excludeMessages: [], addUrlEvents: true, addUrlTypesMessages: true };
    routes[1] = { ...routes[1], [field]: changes[field] };
    expect(verifyUazapiUpdatesSplitReadback(p, routes, globals).ok).toBe(false);
  });
  it('rejects extra routes, reused IDs, global drift and missing global readback', () => {
    const { p, routes } = readback();
    expect(verifyUazapiUpdatesSplitReadback(p, [...routes, { ...unrelated, id: 'surprise' }], globals).ok).toBe(false);
    expect(verifyUazapiUpdatesSplitReadback(p, [...routes, routes[0]], globals).ok).toBe(false);
    expect(verifyUazapiUpdatesSplitReadback(p, routes, [{ ...globals[0], enabled: true }]).ok).toBe(false);
    expect(verifyUazapiUpdatesSplitReadback(p, routes, null).ok).toBe(false);
  });
});
