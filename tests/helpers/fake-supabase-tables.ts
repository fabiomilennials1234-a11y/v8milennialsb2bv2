/**
 * Supabase falso em memória, com tabelas reais (linhas) e os filtros que os
 * leitores de lead por telefone usam: select/eq/in/is/not/order/limit/maybeSingle.
 *
 * Existe para provar o resultado, não a forma da query: o mesmo conjunto de
 * linhas, em qualquer ordem, tem que dar o mesmo lead.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;
export type FakeTables = Record<string, Row[]>;

interface Chain {
  select: () => Chain;
  eq: (c: string, v: unknown) => Chain;
  in: (c: string, vs: unknown[]) => Chain;
  is: (c: string, v: unknown) => Chain;
  not: (c: string, op: string, v: unknown) => Chain;
  order: (c: string, o?: { ascending?: boolean }) => Chain;
  limit: (n: number) => Chain;
  maybeSingle: () => Promise<{ data: Row | null; error: { code: string; message: string } | null }>;
  then: (resolve: (r: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise<unknown>;
}

export function fakeSupabaseTables(tables: FakeTables) {
  const queried: string[] = [];
  const from = (table: string) => {
    queried.push(table);
    let rows = [...(tables[table] ?? [])];
    let orderBy: Array<{ col: string; asc: boolean }> = [];
    let max: number | null = null;

    const run = () => {
      let out = rows;
      for (const { col, asc } of [...orderBy].reverse()) {
        out = [...out].sort((x, y) => {
          const a = x[col] as string | number | null;
          const c = y[col] as string | number | null;
          if (a === c) return 0;
          if (a === null) return asc ? -1 : 1;
          if (c === null) return asc ? 1 : -1;
          return (a < c ? -1 : 1) * (asc ? 1 : -1);
        });
      }
      return max === null ? out : out.slice(0, max);
    };

    const b: Chain = {
      select: () => b,
      eq: (c: string, v: unknown) => ((rows = rows.filter((r) => r[c] === v)), b),
      in: (c: string, vs: unknown[]) => ((rows = rows.filter((r) => vs.includes(r[c]))), b),
      is: (c: string, v: unknown) => ((rows = rows.filter((r) => (r[c] ?? null) === v)), b),
      not: (c: string, op: string, v: unknown) => {
        if (op === "is" && v === null) rows = rows.filter((r) => (r[c] ?? null) !== null);
        return b;
      },
      order: (c: string, o?: { ascending?: boolean }) => (
        (orderBy = [...orderBy, { col: c, asc: o?.ascending !== false }]), b
      ),
      limit: (n: number) => ((max = n), b),
      maybeSingle: () => {
        const out = run();
        if (out.length > 1) {
          return Promise.resolve({ data: null, error: { code: "PGRST116", message: "multiple rows" } });
        }
        return Promise.resolve({ data: out[0] ?? null, error: null });
      },
      then: (resolve: (r: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve({ data: run(), error: null }).then(resolve, reject),
    };
    return b;
  };
  return { supabase: { from } as unknown as SupabaseClient, queried };
}
