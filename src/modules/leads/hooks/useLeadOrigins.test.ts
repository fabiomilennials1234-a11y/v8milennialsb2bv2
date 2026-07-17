/**
 * Regression (schema drift 2026-07-17): a tabela `lead_origins` em prod tem a
 * coluna `name`, não `label`. O hook consultava `label` → todo render de lead
 * disparava `column lead_origins.label does not exist`.
 *
 * Contrato: o hook consulta `name` no banco mas EXPÕE `label` na API pública
 * (LeadOriginOption.label / labelOf / colorOf), mapeando name→label internamente.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createWrapper } from '../../../../tests/helpers/hook-test-utils';

let selectArg: string | undefined;
const orderArgs: unknown[][] = [];
let queryResult: { data: unknown; error: unknown } = { data: [], error: null };

function makeBuilder() {
  const builder: Record<string, unknown> = {
    select: (arg: string) => {
      selectArg = arg;
      return builder;
    },
    order: (...args: unknown[]) => {
      orderArgs.push(args);
      return builder;
    },
    then: (resolve: (v: typeof queryResult) => unknown) => resolve(queryResult),
  };
  return builder;
}

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: () => makeBuilder() },
}));

vi.mock('@/modules/identity', () => ({
  useOrganization: () => ({ organizationId: 'org-123' }),
}));

import { useLeadOrigins, BUILTIN_LEAD_ORIGINS, FALLBACK_ORIGIN_COLOR } from './useLeadOrigins';

describe('useLeadOrigins', () => {
  beforeEach(() => {
    selectArg = undefined;
    orderArgs.length = 0;
    queryResult = { data: [], error: null };
  });

  it('consulta a coluna `name` (não `label`) e ordena por sort_order + name', async () => {
    const { result } = renderHook(() => useLeadOrigins(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(selectArg).toBe('slug,name,color,sort_order,organization_id');
    expect(selectArg).not.toContain('label');
    expect(orderArgs).toEqual([
      ['sort_order', { ascending: true }],
      ['name', { ascending: true }],
    ]);
  });

  it('mapeia name→label no shape retornado (API pública preservada)', async () => {
    queryResult = {
      data: [
        { slug: 'whatsapp', name: 'WhatsApp', color: '#25D366', sort_order: 1, organization_id: null },
        { slug: 'custom_x', name: 'Origem Custom', color: '#ABCDEF', sort_order: 2, organization_id: 'org-123' },
      ],
      error: null,
    };

    const { result } = renderHook(() => useLeadOrigins(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.origins.length).toBe(2));

    expect(result.current.origins).toEqual([
      { slug: 'whatsapp', label: 'WhatsApp', color: '#25D366' },
      { slug: 'custom_x', label: 'Origem Custom', color: '#ABCDEF' },
    ]);
    expect(result.current.labelOf('whatsapp')).toBe('WhatsApp');
    expect(result.current.labelOf('custom_x')).toBe('Origem Custom');
    expect(result.current.colorOf('custom_x')).toBe('#ABCDEF');
  });

  it('override por slug: custom da org (org_id != null) sobrepõe built-in de mesmo slug', async () => {
    queryResult = {
      data: [
        { slug: 'whatsapp', name: 'WhatsApp', color: '#25D366', sort_order: 1, organization_id: null },
        { slug: 'whatsapp', name: 'Zap da Org', color: '#111111', sort_order: 1, organization_id: 'org-123' },
      ],
      error: null,
    };

    const { result } = renderHook(() => useLeadOrigins(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.origins.length).toBe(1));

    expect(result.current.origins[0]).toEqual({ slug: 'whatsapp', label: 'Zap da Org', color: '#111111' });
  });

  it('fallback: usa os built-ins locais quando a query volta vazia', async () => {
    queryResult = { data: [], error: null };

    const { result } = renderHook(() => useLeadOrigins(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.origins).toEqual(BUILTIN_LEAD_ORIGINS);
    expect(result.current.labelOf('whatsapp')).toBe('WhatsApp');
  });

  it('labelOf/colorOf degradam para slug e cor genérica em slug desconhecido', async () => {
    const { result } = renderHook(() => useLeadOrigins(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.labelOf('inexistente')).toBe('inexistente');
    expect(result.current.labelOf(null)).toBe('');
    expect(result.current.colorOf('inexistente')).toBe(FALLBACK_ORIGIN_COLOR);
  });
});
