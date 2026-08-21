/**
 * Higher-level test harness for frontend hooks that depend on
 * Supabase client, organization context, user role, and master auth.
 *
 * Unlike createMockSupabase (which mocks Supabase at data level for _shared modules),
 * createTestDB configures the full React context stack needed by frontend hooks:
 * - QueryClient (retry: false)
 * - useOrganization mock state
 * - useUserRole mock state
 * - useMasterAuth mock state
 * - Supabase client mock with realtime channel support
 *
 * Usage:
 *   // In test file, after vi.mock declarations that delegate to mutable state:
 *   const { wrapper, supabase, emitRealtime } = createTestDB(
 *     { leads: [...], organizations: [...] },
 *     { userRole: 'member', isMaster: false, _mockOrgState, _mockSupabaseState, ... }
 *   );
 *   const { result } = renderHook(() => useMyHook(), { wrapper });
 */

import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMockSupabase } from "./supabase-mock";
import type { Database } from "@/integrations/supabase/types";

type MockData = Record<string, unknown>[];

export interface TestDBTables {
  [table: string]: Partial<Record<string, unknown>>[];
}

export interface TestDBOptions {
  /**
   * Amarrado ao enum do banco de propósito (#1541). Era
   * `"admin" | "master" | "membro"` — dois dos três valores não existem em
   * `app_role`: o banco recusa `membro` com `22P02`, e `master` não é role,
   * é camada à parte (`isMaster`, logo abaixo). Dublê mais frouxo que o real
   * esconde bug — foi assim que um gate comparando `"membro"` passou nos
   * testes e negou todo não-admin em produção.
   */
  userRole?: Database["public"]["Enums"]["app_role"];
  isMaster?: boolean;
  /** Internal: reference to the mutable mockOrgState declared at test module level */
  _mockOrgState?: Record<string, unknown>;
  /** Internal: reference to the mutable mockSupabaseState declared at test module level */
  _mockSupabaseState?: { from: (...args: unknown[]) => unknown; channel: (...args: unknown[]) => unknown };
  /** Internal: reference to the mutable mockUserRoleState declared at test module level */
  _mockUserRoleState?: Record<string, unknown>;
  /** Internal: reference to the mutable mockMasterAuthState declared at test module level */
  _mockMasterAuthState?: Record<string, unknown>;
}

interface RealtimeCallback {
  event: string;
  table: string;
  callback: (payload: unknown) => void;
}

export function createTestDB(tables: TestDBTables, options: TestDBOptions = {}) {
  const {
    userRole = "admin",
    isMaster = false,
    _mockOrgState,
    _mockSupabaseState,
    _mockUserRoleState,
    _mockMasterAuthState,
  } = options;

  // ── Build supabase mock from tables ──
  const { sb, mockTable } = createMockSupabase();

  // Seed tables
  for (const [tableName, rows] of Object.entries(tables)) {
    mockTable(tableName, rows as MockData);
  }

  // ── Realtime channel support ──
  const realtimeCallbacks: RealtimeCallback[] = [];

  const createChannelMock = () => {
    const channelObj: Record<string, unknown> = {
      on: (type: string, filter: { event: string; schema?: string; table: string }, callback: (payload: unknown) => void) => {
        realtimeCallbacks.push({ event: filter.event, table: filter.table, callback });
        return channelObj;
      },
      subscribe: () => channelObj,
      unsubscribe: () => {},
    };
    return channelObj;
  };

  // Enhanced supabase with channel support
  const supabase = {
    from: (table: string) => sb.from(table),
    channel: (_name: string) => createChannelMock(),
    removeChannel: () => {},
  };

  // ── Configure mock states if provided ──
  if (_mockOrgState) {
    const org = (tables.organizations as Record<string, unknown>[] | undefined)?.[0];
    Object.assign(_mockOrgState, {
      organizationId: org?.id ?? "default-org",
      isReady: true,
      isLoading: false,
      teamMemberId: null,
      role: userRole,
      orgType: org?.org_type ?? null,
      error: null,
    });
  }

  if (_mockUserRoleState) {
    Object.assign(_mockUserRoleState, {
      data: { user_id: "user-1", role: userRole },
      isLoading: false,
    });
  }

  if (_mockMasterAuthState) {
    Object.assign(_mockMasterAuthState, {
      isMaster,
      isOutbounder: false,
      masterUser: isMaster ? { id: "master-1", user_id: "user-1", permissions: { all: true }, is_active: true } : null,
      permissions: isMaster ? { all: true } : {},
      hasPermission: () => isMaster,
      isLoading: false,
      error: null,
    });
  }

  if (_mockSupabaseState) {
    _mockSupabaseState.from = supabase.from;
    _mockSupabaseState.channel = supabase.channel as any;
  }

  // ── Emit realtime event ──
  function emitRealtime(table: string, event: "INSERT" | "UPDATE" | "DELETE", row: unknown) {
    const payload = {
      eventType: event,
      new: event === "DELETE" ? {} : row,
      old: event === "INSERT" ? {} : row,
      table,
      schema: "public",
      commit_timestamp: new Date().toISOString(),
    };

    for (const cb of realtimeCallbacks) {
      if (cb.table === table && (cb.event === event || cb.event === "*")) {
        cb.callback(payload);
      }
    }
  }

  // ── QueryClient wrapper ──
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  function wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  }

  return { wrapper, supabase, emitRealtime };
}
