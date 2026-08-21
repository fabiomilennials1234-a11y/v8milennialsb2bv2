/**
 * Lightweight Supabase client mock for unit testing _shared modules.
 *
 * Usage:
 *   const { sb, mockTable } = createMockSupabase();
 *   mockTable('leads', [{ id: '1', name: 'Test' }]);
 *   const result = await myFunction(sb, ...);
 */

type MockData = Record<string, unknown>[];

interface ChainResult {
  data: unknown;
  error: null | { code: string; message: string };
  count: number | null;
}

export function createMockSupabase() {
  const tables: Record<string, MockData> = {};
  const insertedRows: Record<string, MockData> = {};
  const updatedRows: Record<string, MockData> = {};
  const upsertOpts: Record<string, unknown[]> = {};
  const rpcResults: Record<string, unknown> = {};
  /**
   * As chamadas de RPC, na ordem. Existe porque há caminhos cujo efeito
   * observável É a chamada — destravar uma execução de workflow, por exemplo,
   * não deixa rastro em nenhuma tabela que o dublê veja.
   */
  const rpcCalls: Array<{ name: string; params: unknown }> = [];
  const insertErrors: Record<string, { code: string; message: string }> = {};
  const selectErrors: Record<string, { code: string; message: string }> = {};

  function mockTable(name: string, data: MockData) {
    // Clone so the mock owns its rows. Updates persist by mutating rows in
    // tables[] (read-after-write); cloning keeps that from leaking back into
    // shared seed consts across tests.
    tables[name] = data.map((row) => ({ ...row }));
  }

  /** Force the next (and subsequent) inserts on `table` to fail with `error`. */
  function mockInsertError(name: string, error: { code: string; message: string }) {
    insertErrors[name] = error;
  }

  /**
   * Force READS on `table` to resolve `{ data: null, error }`.
   *
   * Existe porque vários módulos tratam falha de leitura de forma diferente de
   * "leitura vazia" (fail-closed vs. seguir em frente), e sem isto o ramo
   * `if (error)` era inalcançável no teste — a suíte ficava verde afirmando um
   * fail-closed que nunca tinha sido exercitado.
   *
   * Só afeta leitura: insert/upsert/update na mesma tabela seguem normais, para
   * o teste poder semear o cenário e depois quebrar só a consulta.
   */
  function mockSelectError(name: string, error: { code: string; message: string }) {
    selectErrors[name] = error;
  }

  function mockRpc(name: string, result: unknown) {
    rpcResults[name] = result;
  }

  function getInserted(table: string): MockData {
    return insertedRows[table] || [];
  }

  function getUpdated(table: string): MockData {
    return updatedRows[table] || [];
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
    let selectOpts: { count?: string; head?: boolean } | null = null;
    let insertError: { code: string; message: string } | null = null;
    let isUpdate = false;
    let isWrite = false;
    let updateData: Record<string, unknown> = {};

    /** Erro de LEITURA mockado — não se aplica a insert/upsert/update. */
    const pendingSelectError = () =>
      !isWrite && !isUpdate && selectErrors[tableName] ? selectErrors[tableName] : null;

    const applyOp = (row: Record<string, unknown>, f: { field: string; op: string; value: unknown }): boolean => {
      const val = row[f.field];
      switch (f.op) {
        case 'eq': return val === f.value;
        case 'neq': return val !== f.value;
        case 'gt': return (val as number) > (f.value as number);
        case 'gte': return (val as number) >= (f.value as number);
        case 'lt': return (val as number) < (f.value as number);
        case 'lte': return (val as number) <= (f.value as number);
        // Postgres `IS NULL` matches absent columns; a fixture that omits the
        // field (undefined) must behave like a real NULL column.
        case 'is': return f.value === null ? (val === null || val === undefined) : val === f.value;
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
      select: (_fields?: string, opts?: { count?: string; head?: boolean }) => {
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
      // `.returns<T>()` is a type-only helper on the real client; pass through.
      returns: () => chain,
      insert: (rows: unknown) => {
        isWrite = true;
        if (insertErrors[tableName]) {
          insertError = insertErrors[tableName];
          return chain;
        }
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
        isWrite = true;
        const arr = Array.isArray(rows) ? rows : [rows];
        if (!insertedRows[tableName]) insertedRows[tableName] = [];
        if (!upsertOpts[tableName]) upsertOpts[tableName] = [];
        upsertOpts[tableName].push(opts);
        const withIds = arr.map((r: any) => ({ id: crypto.randomUUID(), ...r }));
        insertedRows[tableName].push(...withIds);
        data = withIds;
        return chain;
      },
      not: (_field: string, _op: string, _value: unknown) => {
        // For simplicity, not() is a no-op filter in mock
        return chain;
      },
      in: (field: string, values: unknown[]) => {
        filters.push({ field, op: 'in', value: values });
        return chain;
      },
      delete: () => chain,
      single: () => {
        if (insertError) return Promise.resolve({ data: null, error: insertError });
        const selErr = pendingSelectError();
        if (selErr) return Promise.resolve({ data: null, error: selErr });
        const result = applyUpdateIfPending();
        return Promise.resolve({
          data: result[0] || null,
          error: null,
        });
      },
      maybeSingle: () => {
        if (insertError) return Promise.resolve({ data: null, error: insertError });
        const selErr = pendingSelectError();
        if (selErr) return Promise.resolve({ data: null, error: selErr });
        const result = applyUpdateIfPending();
        return Promise.resolve({
          data: result[0] || null,
          error: null,
        });
      },
      then: (resolve: (val: ChainResult) => void) => {
        const result = applyUpdateIfPending();
        resolve({ data: result, error: null, count: result.length });
      },
    };

    /**
     * `.update(...).select().single()` e a forma canonica no codebase. Antes o
     * mock so persistia o update no caminho thenable, entao um hook que
     * terminasse em `.single()` atualizava nada e `getUpdated()` vinha vazio.
     */
    function applyUpdateIfPending(): MockData {
      const matched = applyFilters();
      if (!isUpdate) return matched;
      for (const row of matched) Object.assign(row, updateData);
      if (!updatedRows[tableName]) updatedRows[tableName] = [];
      updatedRows[tableName].push(...matched);
      return matched;
    }

    // Make chain thenable (for await without .single/.maybeSingle)
    chain[Symbol.toStringTag] = 'Promise';
    const defaultPromise = () => {
      if (insertError) {
        return Promise.resolve({ data: null, error: insertError, count: null });
      }
      const selErr = pendingSelectError();
      if (selErr) {
        return Promise.resolve({ data: null, error: selErr, count: null });
      }
      // Persist updates so read-after-write works. applyFilters() returns refs to
      // the shared table row objects, so Object.assign mutates tables in place.
      if (isUpdate) {
        const matched = applyUpdateIfPending();
        return Promise.resolve({ data: matched, error: null, count: matched.length });
      }
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

  // Realtime channel support
  type RealtimeHandler = (payload: { new: unknown; old: unknown; eventType: string }) => void;
  interface ChannelRegistration {
    table: string;
    event: string;
    filter?: string;
    callback: RealtimeHandler;
  }
  const channels: Record<string, { handlers: ChannelRegistration[]; subscribed: boolean }> = {};

  function createChannel(name: string) {
    if (!channels[name]) {
      channels[name] = { handlers: [], subscribed: false };
    }
    const ch = channels[name];

    const channelObj: any = {
      on: (_type: string, opts: { event: string; schema?: string; table: string; filter?: string }, callback: RealtimeHandler) => {
        ch.handlers.push({ table: opts.table, event: opts.event, filter: opts.filter, callback });
        return channelObj;
      },
      subscribe: (statusCallback?: (status: string) => void) => {
        ch.subscribed = true;
        if (statusCallback) statusCallback('SUBSCRIBED');
        return channelObj;
      },
      unsubscribe: () => {
        ch.subscribed = false;
        return channelObj;
      },
    };
    return channelObj;
  }

  function emitEvent(channelName: string, table: string, event: string, payload: { new?: unknown; old?: unknown }) {
    const ch = channels[channelName];
    if (!ch || !ch.subscribed) return;
    for (const handler of ch.handlers) {
      if (handler.table === table && (handler.event === '*' || handler.event === event)) {
        handler.callback({
          new: payload.new ?? null,
          old: payload.old ?? null,
          eventType: event,
        });
      }
    }
  }

  const sb = {
    from: (table: string) => createChain(table),
    rpc: (name: string, params?: unknown) => {
      rpcCalls.push({ name, params });
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
    channel: (name: string) => createChannel(name),
  };

  return { sb: sb as any, mockTable, mockRpc, mockInsertError, mockSelectError, getInserted, getUpdated, getUpsertOpts, emitEvent, getRpcCalls: () => rpcCalls };
}
