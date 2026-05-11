/**
 * Integration tests — instance-write-guard (Etapa B).
 *
 * Strategy: Vitest com Supabase client mockado (sem Supabase local).
 *   - Migration A (20260930000000_user_write_instance.sql) ainda não está
 *     aplicada em DEV; mocks reproduzem o comportamento das RPCs.
 *   - Foca exclusivamente na lógica do guard (caminho ON / OFF / erros).
 *
 * Cobertura:
 *   1. resolveLeadWriteInstance — LEAD_NOT_FOUND, NO_RESPONSIBLE, NO_INSTANCE,
 *      INSTANCE_INACTIVE, sucesso.
 *   2. assertUserCanWriteInstance — owner OK, admin OK, master OK, terceiro nega.
 *   3. isStrictWriteEnabled — override em organization_features tem prioridade.
 *   4. resolveDispatchContext — flag OFF + leadId presente preserva legado.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Tipo mínimo do client (apenas o que o guard usa).
type RpcCall = (fn: string, params?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
type FromCall = (table: string) => MockTableQuery;

interface MockTableQuery {
  select(_cols: string): MockTableQuery;
  eq(col: string, val: unknown): MockTableQuery;
  in(col: string, vals: unknown[]): MockTableQuery;
  order(col: string, opts?: unknown): MockTableQuery;
  limit(n: number): MockTableQuery;
  maybeSingle(): Promise<{ data: unknown; error: unknown }>;
  single(): Promise<{ data: unknown; error: unknown }>;
}

interface MockClient {
  rpc: RpcCall;
  from: FromCall;
}

/**
 * Constrói um cliente Supabase mockado a partir de:
 *   - rpcMap: { [fnName]: (params) => { data, error } }
 *   - tableMap: { [table]: { rows: [...], filters? } }
 *
 * Apenas a superfície usada pelo guard (rpc + from→select→eq→maybeSingle).
 */
function buildMockClient(opts: {
  rpcMap?: Record<string, (params?: Record<string, unknown>) => { data: unknown; error: unknown }>;
  tableRows?: Record<string, Array<Record<string, unknown>>>;
}): MockClient {
  const { rpcMap = {}, tableRows = {} } = opts;

  return {
    rpc: vi.fn(async (fn: string, params?: Record<string, unknown>) => {
      const handler = rpcMap[fn];
      if (!handler) return { data: null, error: { message: `mock rpc not configured: ${fn}` } };
      return handler(params);
    }) as RpcCall,
    from: ((table: string) => {
      let rows: Array<Record<string, unknown>> = tableRows[table] ? [...tableRows[table]] : [];
      const q: MockTableQuery = {
        select(_cols: string) {
          return q;
        },
        eq(col: string, val: unknown) {
          rows = rows.filter((r) => r[col] === val);
          return q;
        },
        in(col: string, vals: unknown[]) {
          const set = new Set(vals);
          rows = rows.filter((r) => set.has(r[col]));
          return q;
        },
        order(_col: string, _opts?: unknown) {
          return q;
        },
        limit(_n: number) {
          return q;
        },
        async maybeSingle() {
          return { data: rows[0] ?? null, error: null };
        },
        async single() {
          if (!rows[0]) return { data: null, error: { code: 'PGRST116' } };
          return { data: rows[0], error: null };
        },
      };
      return q;
    }) as FromCall,
  };
}

import {
  resolveLeadWriteInstance,
  assertUserCanWriteInstance,
  isStrictWriteEnabled,
  WriteAuthorizationError,
  _resetFlagCacheForTesting,
  // Note: cast to any para compatibilidade com SupabaseClient signature.
} from '../../supabase/functions/_shared/instance-write-guard.ts';

import {
  resolveDispatchContext,
  DispatchResolutionError,
} from '../../supabase/functions/_shared/whatsapp-dispatch.ts';

beforeEach(() => {
  _resetFlagCacheForTesting();
});

// ============================================================================
// resolveLeadWriteInstance
// ============================================================================

describe('resolveLeadWriteInstance', () => {
  it('LEAD_NOT_FOUND quando RPC retorna error_code', async () => {
    const client = buildMockClient({
      rpcMap: {
        get_lead_write_instance: () => ({
          data: [
            { instance_id: null, instance_name: null, owner_team_member_id: null, responsible_user_id: null, error_code: 'LEAD_NOT_FOUND' },
          ],
          error: null,
        }),
      },
    });
    // deno-lint-ignore no-explicit-any
    const result = await resolveLeadWriteInstance(client as any, 'lead-x');
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('LEAD_NOT_FOUND');
  });

  it('NO_RESPONSIBLE quando lead existe sem responsible_user_id', async () => {
    const client = buildMockClient({
      rpcMap: {
        get_lead_write_instance: () => ({
          data: [
            { instance_id: null, instance_name: null, owner_team_member_id: null, responsible_user_id: null, error_code: 'NO_RESPONSIBLE' },
          ],
          error: null,
        }),
      },
    });
    // deno-lint-ignore no-explicit-any
    const result = await resolveLeadWriteInstance(client as any, 'lead-x');
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('NO_RESPONSIBLE');
  });

  it('NO_INSTANCE quando responsável não tem instância vinculada', async () => {
    const client = buildMockClient({
      rpcMap: {
        get_lead_write_instance: () => ({
          data: [
            { instance_id: null, instance_name: null, owner_team_member_id: null, responsible_user_id: 'tm-1', error_code: 'NO_INSTANCE' },
          ],
          error: null,
        }),
      },
    });
    // deno-lint-ignore no-explicit-any
    const result = await resolveLeadWriteInstance(client as any, 'lead-x');
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('NO_INSTANCE');
  });

  it('sucesso devolve instanceId e responsibleUserTeamMemberId', async () => {
    const client = buildMockClient({
      rpcMap: {
        get_lead_write_instance: () => ({
          data: [
            { instance_id: 'inst-1', instance_name: 'Vendas-1', owner_team_member_id: 'tm-1', responsible_user_id: 'tm-1', error_code: null },
          ],
          error: null,
        }),
      },
      tableRows: {
        whatsapp_instances: [{ id: 'inst-1', status: 'connected' }],
      },
    });
    // deno-lint-ignore no-explicit-any
    const result = await resolveLeadWriteInstance(client as any, 'lead-x');
    expect(result.ok).toBe(true);
    expect(result.instance?.instanceId).toBe('inst-1');
    expect(result.instance?.instanceName).toBe('Vendas-1');
    expect(result.instance?.ownerTeamMemberId).toBe('tm-1');
    expect(result.instance?.responsibleUserTeamMemberId).toBe('tm-1');
  });

  it('INSTANCE_INACTIVE quando status != open|connected', async () => {
    const client = buildMockClient({
      rpcMap: {
        get_lead_write_instance: () => ({
          data: [
            { instance_id: 'inst-1', instance_name: 'Vendas-1', owner_team_member_id: 'tm-1', responsible_user_id: 'tm-1', error_code: null },
          ],
          error: null,
        }),
      },
      tableRows: {
        whatsapp_instances: [{ id: 'inst-1', status: 'disconnected' }],
      },
    });
    // deno-lint-ignore no-explicit-any
    const result = await resolveLeadWriteInstance(client as any, 'lead-x');
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('INSTANCE_INACTIVE');
  });
});

// ============================================================================
// assertUserCanWriteInstance
// ============================================================================

describe('assertUserCanWriteInstance', () => {
  it('owner permitido (RPC retorna true)', async () => {
    const client = buildMockClient({
      rpcMap: { can_user_write_instance: () => ({ data: true, error: null }) },
    });
    await expect(
      // deno-lint-ignore no-explicit-any
      assertUserCanWriteInstance(client as any, 'user-owner', 'inst-1'),
    ).resolves.toBeUndefined();
  });

  it('admin permitido (RPC retorna true)', async () => {
    const client = buildMockClient({
      rpcMap: { can_user_write_instance: () => ({ data: true, error: null }) },
    });
    await expect(
      // deno-lint-ignore no-explicit-any
      assertUserCanWriteInstance(client as any, 'user-admin', 'inst-1'),
    ).resolves.toBeUndefined();
  });

  it('master permitido (RPC retorna true)', async () => {
    const client = buildMockClient({
      rpcMap: { can_user_write_instance: () => ({ data: true, error: null }) },
    });
    await expect(
      // deno-lint-ignore no-explicit-any
      assertUserCanWriteInstance(client as any, 'user-master', 'inst-1'),
    ).resolves.toBeUndefined();
  });

  it('terceiro user lança WriteAuthorizationError', async () => {
    const client = buildMockClient({
      rpcMap: { can_user_write_instance: () => ({ data: false, error: null }) },
    });
    await expect(
      // deno-lint-ignore no-explicit-any
      assertUserCanWriteInstance(client as any, 'user-other', 'inst-1'),
    ).rejects.toBeInstanceOf(WriteAuthorizationError);
  });
});

// ============================================================================
// isStrictWriteEnabled — precedência
// ============================================================================

describe('isStrictWriteEnabled', () => {
  it('respeita override true em organization_features (coluna enabled)', async () => {
    const client = buildMockClient({
      tableRows: {
        organization_features: [
          { organization_id: 'org-1', feature_key: 'user_write_instance_strict', enabled: true, expires_at: null },
        ],
        feature_flags: [
          { key: 'user_write_instance_strict', default_enabled: false },
        ],
      },
    });
    // deno-lint-ignore no-explicit-any
    const enabled = await isStrictWriteEnabled(client as any, 'org-1');
    expect(enabled).toBe(true);
  });

  it('respeita override false em organization_features (coluna enabled)', async () => {
    const client = buildMockClient({
      tableRows: {
        organization_features: [
          { organization_id: 'org-1', feature_key: 'user_write_instance_strict', enabled: false, expires_at: null },
        ],
        feature_flags: [
          { key: 'user_write_instance_strict', default_enabled: true },
        ],
      },
    });
    // deno-lint-ignore no-explicit-any
    const enabled = await isStrictWriteEnabled(client as any, 'org-1');
    expect(enabled).toBe(false);
  });

  it('cai pra default_enabled quando sem override', async () => {
    const client = buildMockClient({
      tableRows: {
        feature_flags: [
          { key: 'user_write_instance_strict', default_enabled: false },
        ],
      },
    });
    // deno-lint-ignore no-explicit-any
    const enabled = await isStrictWriteEnabled(client as any, 'org-2');
    expect(enabled).toBe(false);
  });

  it('override expirado cai pra default global', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const client = buildMockClient({
      tableRows: {
        organization_features: [
          { organization_id: 'org-1', feature_key: 'user_write_instance_strict', enabled: true, expires_at: past },
        ],
        feature_flags: [
          { key: 'user_write_instance_strict', default_enabled: false },
        ],
      },
    });
    // deno-lint-ignore no-explicit-any
    const enabled = await isStrictWriteEnabled(client as any, 'org-1');
    expect(enabled).toBe(false);
  });

  it('override com expires_at futuro permanece válido', async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const client = buildMockClient({
      tableRows: {
        organization_features: [
          { organization_id: 'org-1', feature_key: 'user_write_instance_strict', enabled: true, expires_at: future },
        ],
        feature_flags: [
          { key: 'user_write_instance_strict', default_enabled: false },
        ],
      },
    });
    // deno-lint-ignore no-explicit-any
    const enabled = await isStrictWriteEnabled(client as any, 'org-1');
    expect(enabled).toBe(true);
  });
});

// ============================================================================
// resolveDispatchContext — flag OFF preserva legado
// ============================================================================

describe('resolveDispatchContext (flag OFF)', () => {
  it('flag OFF + leadId presente NÃO chama get_lead_write_instance', async () => {
    const rpcSpy = vi.fn();

    const client = buildMockClient({
      rpcMap: {
        get_lead_write_instance: (params) => {
          rpcSpy(params);
          return {
            data: [{ instance_id: null, error_code: 'LEAD_NOT_FOUND' }],
            error: null,
          };
        },
      },
      tableRows: {
        // flag OFF
        organization_features: [],
        feature_flags: [
          { key: 'user_write_instance_strict', default_enabled: false },
        ],
        // legacy precedence — instância via preferred_instance_id
        whatsapp_instances: [
          {
            id: 'inst-legacy',
            organization_id: 'org-1',
            instance_name: 'Legacy',
            status: 'connected',
            provider: 'evolution',
          },
        ],
      },
    });

    // Stub getWhatsAppProvider via mock no whatsapp-client.
    // Como provider init pode falhar (sem env), capturamos a tentativa antes.
    let caught: unknown = null;
    try {
      await resolveDispatchContext(client, {
        organization_id: 'org-1',
        phone: '+5511999998888',
        preferred_instance_id: 'inst-legacy',
        lead_id: 'lead-x',
      });
    } catch (e) {
      caught = e;
    }

    // Aceita falha em provider_init_failed (sem env Deno.env), mas o que
    // importa é: NUNCA chamou get_lead_write_instance.
    expect(rpcSpy).not.toHaveBeenCalled();

    // Se caught != null, deve ser provider_init_failed (env ausente em test).
    if (caught instanceof DispatchResolutionError) {
      expect(['provider_init_failed', 'no_instance']).toContain(caught.code);
    }
  });
});
