/**
 * Lightweight Supabase client mock for unit testing _shared modules.
 *
 * Usage:
 *   const { sb, mockTable } = createMockSupabase();
 *   mockTable('leads', [{ id: '1', name: 'Test' }]);
 *   const result = await myFunction(sb, ...);
 */

import { vi } from 'vitest';

type MockData = Record<string, unknown>[];

interface ChainResult {
  data: unknown;
  error: null | { code: string; message: string };
  count: number | null;
}

export function createMockSupabase() {
  const tables: Record<string, MockData> = {};
  const insertedRows: Record<string, MockData> = {};
  const upsertOpts: Record<string, unknown[]> = {};
  const rpcResults: Record<string, unknown> = {};

  function mockTable(name: string, data: MockData) {
    tables[name] = data;
  }

  function mockRpc(name: string, result: unknown) {
    rpcResults[name] = result;
  }

  function getInserted(table: string): MockData {
    return insertedRows[table] || [];
  }

  function getUpsertOpts(table: string): unknown[] {
    return upsertOpts[table] || [];
  }

  function createChain(tableName: string): any {
    let data = [...(tables[tableName] || [])];
    let filters: Array<{ field: string; op: string; value: unknown }> = [];
    let orderField: string | null = null;
    let orderAsc = true;
    let limitCount: number | null = null;
    let selectFields: string = '*';
    let isInsert = false;
    let insertData: unknown = null;
    let isDelete = false;
    let isUpdate = false;
    let updateData: Record<string, unknown> = {};

    const applyFilters = () => {
      let result = [...data];
      for (const f of filters) {
        result = result.filter((row) => {
          const val = row[f.field];
          switch (f.op) {
            case 'eq': return val === f.value;
            case 'neq': return val !== f.value;
            case 'ilike': return typeof val === 'string' && typeof f.value === 'string' &&
              val.toLowerCase() === f.value.toLowerCase();
            case 'contains': return Array.isArray(val) && Array.isArray(f.value) &&
              f.value.every((v: unknown) => val.includes(v));
            case 'in': return Array.isArray(f.value) && (f.value as unknown[]).includes(val);
            default: return true;
          }
        });
      }
      if (orderField) {
        result.sort((a, b) => {
          const av = a[orderField!] as string;
          const bv = b[orderField!] as string;
          return orderAsc ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
        });
      }
      if (limitCount !== null) {
        result = result.slice(0, limitCount);
      }
      return result;
    };

    const chain: any = {
      select: (fields?: string) => { selectFields = fields || '*'; return chain; },
      eq: (field: string, value: unknown) => { filters.push({ field, op: 'eq', value }); return chain; },
      neq: (field: string, value: unknown) => { filters.push({ field, op: 'neq', value }); return chain; },
      ilike: (field: string, value: unknown) => { filters.push({ field, op: 'ilike', value }); return chain; },
      contains: (field: string, value: unknown) => { filters.push({ field, op: 'contains', value }); return chain; },
      order: (field: string, opts?: { ascending?: boolean }) => {
        orderField = field;
        orderAsc = opts?.ascending !== false;
        return chain;
      },
      limit: (n: number) => { limitCount = n; return chain; },
      insert: (rows: unknown) => {
        isInsert = true;
        insertData = rows;
        const arr = Array.isArray(rows) ? rows : [rows];
        if (!insertedRows[tableName]) insertedRows[tableName] = [];
        const withIds = arr.map((r: any) => ({ id: crypto.randomUUID(), ...r }));
        insertedRows[tableName].push(...withIds);
        data = withIds;
        return chain;
      },
      update: (vals: Record<string, unknown>) => {
        isUpdate = true;
        updateData = vals;
        return chain;
      },
      upsert: (rows: unknown, opts?: unknown) => {
        isInsert = true;
        insertData = rows;
        const arr = Array.isArray(rows) ? rows : [rows];
        if (!insertedRows[tableName]) insertedRows[tableName] = [];
        if (!upsertOpts[tableName]) upsertOpts[tableName] = [];
        upsertOpts[tableName].push(opts);
        const withIds = arr.map((r: any) => ({ id: crypto.randomUUID(), ...r }));
        insertedRows[tableName].push(...withIds);
        data = withIds;
        return chain;
      },
      not: (field: string, op: string, value: unknown) => {
        // For simplicity, not() is a no-op filter in mock
        return chain;
      },
      in: (field: string, values: unknown[]) => {
        filters.push({ field, op: 'in', value: values });
        return chain;
      },
      delete: () => { isDelete = true; return chain; },
      single: () => {
        const result = applyFilters();
        return Promise.resolve({
          data: result[0] || null,
          error: null,
        });
      },
      maybeSingle: () => {
        const result = applyFilters();
        return Promise.resolve({
          data: result[0] || null,
          error: null,
        });
      },
      then: (resolve: (val: ChainResult) => void) => {
        const result = applyFilters();
        resolve({ data: result, error: null, count: result.length });
      },
    };

    // Make chain thenable (for await without .single/.maybeSingle)
    chain[Symbol.toStringTag] = 'Promise';
    const defaultPromise = () => Promise.resolve({
      data: applyFilters(),
      error: null,
      count: null,
    });
    chain.then = (onFulfilled?: (val: any) => any, onRejected?: (err: any) => any) => {
      return defaultPromise().then(onFulfilled, onRejected);
    };
    chain.catch = (onRejected?: (err: any) => any) => defaultPromise().catch(onRejected);

    return chain;
  }

  const sb = {
    from: (table: string) => createChain(table),
    rpc: (name: string, params?: unknown) => {
      return Promise.resolve({
        data: rpcResults[name] ?? null,
        error: rpcResults[name] !== undefined ? null : { message: 'RPC not mocked' },
      });
    },
    auth: {
      getUser: () => Promise.resolve({ data: { user: null }, error: null }),
    },
    storage: {
      from: (_bucket: string) => ({
        createSignedUrl: (_path: string, _expiresIn: number) => Promise.resolve({
          data: { signedUrl: 'https://storage.test/signed-url' },
          error: null,
        }),
      }),
    },
  };

  return { sb: sb as any, mockTable, mockRpc, getInserted, getUpsertOpts };
}
