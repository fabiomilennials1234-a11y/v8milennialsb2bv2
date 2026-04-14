/**
 * Shared utilities for testing React hooks that depend on
 * Supabase, React Query, AuthContext, and OrganizationContext.
 *
 * Usage:
 *   import { createWrapper, mockSupabaseQuery, mockSupabaseInsert } from '../helpers/hook-test-utils';
 *   const { result } = renderHook(() => useMyHook(), { wrapper: createWrapper() });
 */

import { vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

/**
 * Creates a QueryClientProvider wrapper for renderHook.
 * Disables retries and GC for deterministic tests.
 */
export function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

/**
 * Sets up a mock for supabase.from().select().eq()... chain
 * that resolves with the given data.
 */
export function mockSupabaseQuery(mockFrom: ReturnType<typeof vi.fn>, data: unknown[], error: unknown = null) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    range: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: data[0] || null, error }),
    maybeSingle: vi.fn().mockResolvedValue({ data: data[0] || null, error }),
    then: (fn: Function) => Promise.resolve(fn({ data, error, count: data.length })),
  };
  // Make chain thenable
  Object.defineProperty(chain, 'then', {
    value: (onFulfilled?: (val: any) => any) => {
      return Promise.resolve({ data, error, count: data.length }).then(onFulfilled);
    },
    writable: true,
  });
  mockFrom.mockReturnValue(chain);
  return chain;
}

/**
 * Sets up a mock for supabase.from().insert().select().single() chain.
 */
export function mockSupabaseInsert(mockFrom: ReturnType<typeof vi.fn>, returnData: unknown, error: unknown = null) {
  const chain = {
    insert: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: returnData, error }),
      }),
    }),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    then: (fn: Function) => Promise.resolve(fn({ data: returnData, error })),
  };
  mockFrom.mockReturnValue(chain);
  return chain;
}
