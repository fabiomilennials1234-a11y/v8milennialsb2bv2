/**
 * Slice 6 — send-media-selector: gate de seleção/envio puro (Copilot v2)
 *
 * ADR #5: antes do send_media um gate decide "já enviou? item válido?".
 * Fail-CLOSED: item inativo, de outra org, inexistente, ou já enviado nesta
 * conversa → bloqueia (motivo explícito, nunca silent-drop — lição VitrineVET).
 * assertWithinCap é testado nas DUAS leituras do cap (decisão de produto aberta).
 */
import { describe, it, expect } from 'vitest';
import {
  decideSendMedia,
  assertWithinCap,
  type SendMediaItem,
} from '../../../supabase/functions/_shared/copilot-v2/send-media-selector.ts';

const item = (over: Partial<SendMediaItem> = {}): SendMediaItem => ({
  id: 'm1', organization_id: 'org-1', kind: 'image', storage_path: 'org-1/a.png',
  is_active: true, ...over,
});

describe('decideSendMedia — gate fail-CLOSED', () => {
  it('permite um item ativo da org ainda não enviado', () => {
    expect(decideSendMedia({ orgId: 'org-1', item: item(), alreadySentMediaIds: [] }))
      .toEqual({ allowed: true, reason: null });
  });
  it('bloqueia item já enviado nesta conversa (anti-repetição)', () => {
    expect(decideSendMedia({ orgId: 'org-1', item: item(), alreadySentMediaIds: ['m1'] }))
      .toEqual({ allowed: false, reason: 'already_sent' });
  });
  it('bloqueia item inativo', () => {
    expect(decideSendMedia({ orgId: 'org-1', item: item({ is_active: false }), alreadySentMediaIds: [] }))
      .toEqual({ allowed: false, reason: 'item_inactive' });
  });
  it('bloqueia item de OUTRA org (isolamento multi-tenant)', () => {
    expect(decideSendMedia({ orgId: 'org-1', item: item({ organization_id: 'org-EVIL' }), alreadySentMediaIds: [] }))
      .toEqual({ allowed: false, reason: 'cross_org' });
  });
  it('bloqueia item inexistente (null)', () => {
    expect(decideSendMedia({ orgId: 'org-1', item: null, alreadySentMediaIds: [] }))
      .toEqual({ allowed: false, reason: 'not_found' });
  });
});

describe('assertWithinCap — parametrizado (DECISÃO DE PRODUTO ABERTA)', () => {
  const five = (kind: SendMediaItem['kind']) => Array.from({ length: 5 }, (_, i) => item({ id: `${kind}-${i}`, kind }));
  it('modo per_kind: 5 imagens OK, 6ª imagem estoura', () => {
    expect(assertWithinCap(five('image'), { mode: 'per_kind', limit: 5 }).ok).toBe(true);
    expect(assertWithinCap([...five('image'), item({ id: 'x', kind: 'image' })], { mode: 'per_kind', limit: 5 }))
      .toMatchObject({ ok: false, reason: 'cap_exceeded', kind: 'image' });
  });
  it('modo per_kind: 5 de cada tipo (15 total) OK', () => {
    const all = [...five('image'), ...five('video'), ...five('audio')];
    expect(assertWithinCap(all, { mode: 'per_kind', limit: 5 }).ok).toBe(true);
  });
  it('modo total: estoura no limite agregado independentemente do tipo', () => {
    const items = Array.from({ length: 9 }, (_, i) => item({ id: `i-${i}`, kind: i % 2 ? 'video' : 'image' }));
    expect(assertWithinCap(items, { mode: 'total', limit: 8 })).toMatchObject({ ok: false, reason: 'cap_exceeded' });
    expect(assertWithinCap(items.slice(0, 8), { mode: 'total', limit: 8 }).ok).toBe(true);
  });
});
