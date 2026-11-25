import { assertEquals } from "jsr:@std/assert@^1.0.0";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { motivoFalhaDeInsercao, reportRow } from "./import-report.ts";

Deno.test("reportRow — usa a linha da planilha quando o navegador mandou", () => {
  // 1ª linha de dados da planilha = linha 2 (cabeçalho = 1); posição no array = 0.
  assertEquals(reportRow({ source_row: 2 }, 0), 2);
  // linhas vazias/sem nome descartadas antes: a posição (7) não é a linha (12).
  assertEquals(reportRow({ source_row: 12 }, 7), 12);
});

Deno.test("reportRow — sem source_row (n8n/API) cai na posição + 1", () => {
  assertEquals(reportRow({}, 0), 1);
  assertEquals(reportRow({ source_row: undefined }, 4), 5);
});

Deno.test("reportRow — source_row inválido é ignorado", () => {
  assertEquals(reportRow({ source_row: 0 }, 3), 4);
  assertEquals(reportRow({ source_row: -2 }, 3), 4);
  assertEquals(reportRow({ source_row: 2.5 }, 3), 4);
  assertEquals(reportRow({ source_row: "9" as unknown as number }, 3), 4);
});

interface Chain {
  select: () => Chain;
  eq: () => Chain;
  is: () => Chain;
  limit: () => Chain;
  maybeSingle: () => Promise<{ data: unknown }>;
}

function fakeDb(opts: { norm?: unknown; dono?: unknown; rpcThrows?: boolean }): SupabaseClient {
  const chain: Chain = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    limit: () => chain,
    maybeSingle: () => Promise.resolve({ data: opts.dono ?? null }),
  };
  const db = {
    rpc: () => {
      if (opts.rpcThrows) throw new Error("rpc fora do ar");
      return Promise.resolve({ data: opts.norm ?? null });
    },
    from: () => chain,
  };
  return db as unknown as SupabaseClient;
}

Deno.test("motivoFalhaDeInsercao — erro que não é de telefone segue truncado", async () => {
  const msg = await motivoFalhaDeInsercao(fakeDb({}), "org", { message: "x".repeat(300) }, "5547999990000");
  assertEquals(msg.startsWith("Erro ao inserir lead: "), true);
  assertEquals(msg.endsWith("…"), true);
});

Deno.test("motivoFalhaDeInsercao — índice do telefone vira 'já existe' com o nome do dono", async () => {
  const db = fakeDb({ norm: "47933682067", dono: { name: "HOTEL D LUZ", company: "Hotel D'Luz" } });
  const msg = await motivoFalhaDeInsercao(
    db,
    "org",
    { message: 'duplicate key value violates unique constraint "idx_leads_org_phone_unique"', code: "23505" },
    "554733682067",
  );
  assertEquals(msg, `Já existe um lead com este telefone: "Hotel D'Luz"`);
});

Deno.test("motivoFalhaDeInsercao — sem achar o dono ou com RPC falhando, ainda diz 'já existe'", async () => {
  const err = { message: "idx_leads_org_phone_unique", code: "23505" };
  assertEquals(await motivoFalhaDeInsercao(fakeDb({ norm: "47933682067" }), "org", err, "554733682067"), "Já existe um lead com este telefone");
  assertEquals(await motivoFalhaDeInsercao(fakeDb({ rpcThrows: true }), "org", err, "554733682067"), "Já existe um lead com este telefone");
  assertEquals(await motivoFalhaDeInsercao(fakeDb({}), "org", err, undefined), "Já existe um lead com este telefone");
});

Deno.test("motivoFalhaDeInsercao — a frase casa o padrão de duplicata que a tela usa", async () => {
  const msg = await motivoFalhaDeInsercao(fakeDb({}), "org", { code: "23505" }, undefined);
  assertEquals(/duplicado|ja existe|já existe|sem dados novos/i.test(msg), true);
});
