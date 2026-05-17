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
    let orFilters: Array<Array<{ field: string; op: string; value: unknown }>> = [];
    let textSearchFilters: Array<{ field: string; query: string }> = [];
    let orderField: string | null = null;
    let orderAsc = true;
    let limitCount: number | null = null;
    let selectFields: string = '*';
    let selectOpts: { count?: string; head?: boolean } | null = null;
    let isInsert = false;
    let insertData: unknown = null;
    let isDelete = false;
    let isUpdate = false;
    let updateData: Record<string, unknown> = {};

    const applyOp = (row: Record<string, unknown>, f: { field: string; op: string; value: unknown }): boolean => {
      const val = row[f.field];
      switch (f.op) {
        case 'eq': return val === f.value;
        case 'neq': return val !== f.value;
        case 'gt': return (val as number) > (f.value as number);
        case 'gte': return (val as number) >= (f.value as number);
        case 'lt': return (val as number) < (f.value as number);
        case 'lte': return (val as number) <= (f.value as number);
        case 'is': return val === f.value;
        case 'ilike': return typeof val === 'string' && typeof f.value === 'string' &&
          val.toLowerCase() === f.value.toLowerCase();
        case 'contains': return Array.isArray(val) && Array.isArray(f.value) &&
          f.value.every((v: unknown) => val.includes(v));
        case 'in': return Array.isArray(f.value) && (f.value as unknown[]).includes(val);
        default: return true;
      }
    };

    const parseOrFilter = (filterStr: string): Array<{ field: string; op: string; value: unknown }> => {
      const conditions: Array<{ field: string; op: string; value: unknown }> = [];
      const parts = filterStr.split(',');
      for (const part of parts) {
        // Handle is.null special case: field.is.null
        const isNullMatch = part.match(/^(.+)\.is\.null$/);
        if (isNullMatch) {
          conditions.push({ field: isNullMatch[1], op: 'is', value: null });
          continue;
        }
        // Standard format: field.op.value
        const match = part.match(/^([^.]+)\.([^.]+)\.(.+)$/);
        if (match) {
          const [, field, op, rawValue] = match;
          let value: unknown = rawValue;
          // Parse numeric values
          if (!isNaN(Number(rawValue))) {
            value = Number(rawValue);
          } else if (rawValue === 'true') {
            value = true;
          } else if (rawValue === 'false') {
            value = false;
          }
          conditions.push({ field, op, value });
        }
      }
      return conditions;
    };

    const applyFilters = () => {
      let result = [...data];
      // AND filters
      for (const f of filters) {
        result = result.filter((row) => applyOp(row, f));
      }
      // OR filters (each orFilters entry is one .or() call)
      for (const orGroup of orFilters) {
        result = result.filter((row) => orGroup.some((f) => applyOp(row, f)));
      }
      // Text search filters
      for (const ts of textSearchFilters) {
        result = result.filter((row) => {
          const val = row[ts.field];
          if (typeof val !== 'string') return false;
          return val.toLowerCase().includes(ts.query.toLowerCase());
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
      select: (fields?: string, opts?: { count?: string; head?: boolean }) => {
        selectFields = fields || '*';
        if (opts) selectOpts = opts;
        return chain;
      },
      eq: (field: string, value: unknown) => { filters.push({ field, op: 'eq', value }); return chain; },
      neq: (field: string, value: unknown) => { filters.push({ field, op: 'neq', value }); return chain; },
      gte: (field: string, value: unknown) => { filters.push({ field, op: 'gte', value }); return chain; },
      lte: (field: string, value: unknown) => { filters.push({ field, op: 'lte', value }); return chain; },
      gt: (field: string, value: unknown) => { filters.push({ field, op: 'gt', value }); return chain; },
      lt: (field: string, value: unknown) => { filters.push({ field, op: 'lt', value }); return chain; },
      is: (field: string, value: unknown) => { filters.push({ field, op: 'is', value }); return chain; },
      ilike: (field: string, value: unknown) => { filters.push({ field, op: 'ilike', value }); return chain; },
      contains: (field: string, value: unknown) => { filters.push({ field, op: 'contains', value }); return chain; },
      or: (filterStr: string) => { orFilters.push(parseOrFilter(filterStr)); return chain; },
      textSearch: (field: string, query: string) => { textSearchFilters.push({ field, query }); return chain; },
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
    const defaultPromise = () => {
      const filtered = applyFilters();
      if (selectOpts?.head) {
        return Promise.resolve({
          data: null,
          error: null,
          count: filtered.length,
        });
      }
      if (selectOpts?.count) {
        return Promise.resolve({
          data: filtered,
          error: null,
          count: filtered.length,
        });
      }
      return Promise.resolve({
        data: filtered,
        error: null,
        count: null,
      });
    };
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
