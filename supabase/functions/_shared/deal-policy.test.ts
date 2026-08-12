/**
 * Testes de `isDealManualOnly` — a leitura da flag que decide se um Negócio pode
 * nascer de ingest (ADR-0023 decisão 3).
 *
 * Quatro coisas precisam ficar travadas aqui, porque errar qualquer uma é bug mudo:
 *   1. "ligada" é ESTRITAMENTE `true` — a mesma semântica do
 *      `= 'true'::jsonb` da migration 20270730000040:289 e do `=== true` de
 *      `useFeatureFlag.ts:51`. Truthy ligaria a flag com a string "false".
 *   2. erro de leitura é FAIL-OPEN — devolve false e o lead entra em funil como
 *      sempre entrou. Fail-closed transformaria um soluço de rede em "ninguém
 *      entra em funil nenhum" nas 95 orgs com a flag desligada.
 *   3. o cache não pode guardar decisão tomada em cima de erro ou de linha
 *      ausente (linha ausente pode ser RLS escondendo a org).
 *   4. o cache é por org.
 */
import { assertEquals } from "jsr:@std/assert@^1.0.0";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isDealManualOnly, __resetDealPolicyCache } from "./deal-policy.ts";

interface OrgRow {
  feature_flags: Record<string, unknown> | null;
}

interface QueryResult {
  data: OrgRow | null;
  error: { message: string } | null;
}

interface FakeBuilder {
  select: () => FakeBuilder;
  eq: (column?: string, value?: string) => FakeBuilder;
  maybeSingle: () => Promise<QueryResult>;
}

/**
 * Fake mínimo do builder: `.from().select().eq().maybeSingle()`.
 *
 * `resolve` é função (e não valor) para o caso multi-org, onde a resposta
 * depende do id que o `.eq()` acabou de ver.
 */
function fakeSupabase(
  resolve: () => QueryResult,
  counter?: { n: number },
): SupabaseClient {
  const build = (): FakeBuilder => {
    const builder: FakeBuilder = {
      select: () => builder,
      eq: () => builder,
      maybeSingle: () => {
        if (counter) counter.n++;
        return Promise.resolve(resolve());
      },
    };
    return builder;
  };
  return { from: () => build() } as unknown as SupabaseClient;
}

/** Açúcar: resposta fixa. */
function withFlags(flags: Record<string, unknown> | null, counter?: { n: number }): SupabaseClient {
  return fakeSupabase(() => ({ data: { feature_flags: flags }, error: null }), counter);
}

Deno.test("flag estritamente true → manual-only", async () => {
  __resetDealPolicyCache();
  assertEquals(await isDealManualOnly(withFlags({ deal_manual_only: true }), "org-1"), true);
});

Deno.test("flag ausente → false (org semeia funil como sempre)", async () => {
  __resetDealPolicyCache();
  assertEquals(await isDealManualOnly(withFlags({ outra_flag: true }), "org-1"), false);
});

Deno.test("feature_flags vazio → false", async () => {
  __resetDealPolicyCache();
  assertEquals(await isDealManualOnly(withFlags({}), "org-1"), false);
});

Deno.test("feature_flags null → false (não explode)", async () => {
  __resetDealPolicyCache();
  assertEquals(await isDealManualOnly(withFlags(null), "org-1"), false);
});

Deno.test('string "true" NÃO liga a flag — comparação é estrita', async () => {
  __resetDealPolicyCache();
  assertEquals(await isDealManualOnly(withFlags({ deal_manual_only: "true" }), "org-1"), false);
});

Deno.test('string "false" NÃO liga a flag — truthy seria o bug clássico', async () => {
  __resetDealPolicyCache();
  assertEquals(await isDealManualOnly(withFlags({ deal_manual_only: "false" }), "org-1"), false);
});

Deno.test("linha ausente (data null) → false, e NÃO cacheia", async () => {
  __resetDealPolicyCache();
  const counter = { n: 0 };
  const supa = fakeSupabase(() => ({ data: null, error: null }), counter);
  assertEquals(await isDealManualOnly(supa, "org-inexistente"), false);
  // "linha não veio" pode ser RLS escondendo a org de um client sem
  // service_role. Cachear isso desligaria a política por 30s a cada vez.
  assertEquals(await isDealManualOnly(supa, "org-inexistente"), false);
  assertEquals(counter.n, 2);
});

Deno.test("erro de leitura → false (fail-open)", async () => {
  __resetDealPolicyCache();
  const supa = fakeSupabase(() => ({ data: null, error: { message: "boom" } }));
  assertEquals(await isDealManualOnly(supa, "org-1"), false);
});

Deno.test("orgId vazio → false, sem consultar o banco", async () => {
  __resetDealPolicyCache();
  const counter = { n: 0 };
  const supa = withFlags({ deal_manual_only: true }, counter);
  assertEquals(await isDealManualOnly(supa, null), false);
  assertEquals(await isDealManualOnly(supa, ""), false);
  assertEquals(counter.n, 0);
});

Deno.test("segunda chamada na mesma org vem do cache", async () => {
  __resetDealPolicyCache();
  const counter = { n: 0 };
  const supa = withFlags({ deal_manual_only: true }, counter);
  assertEquals(await isDealManualOnly(supa, "org-1"), true);
  assertEquals(await isDealManualOnly(supa, "org-1"), true);
  assertEquals(counter.n, 1);
});

Deno.test("erro NÃO é cacheado — a próxima chamada tenta de novo", async () => {
  __resetDealPolicyCache();
  const counter = { n: 0 };
  const supa = fakeSupabase(() => ({ data: null, error: { message: "boom" } }), counter);
  assertEquals(await isDealManualOnly(supa, "org-1"), false);
  assertEquals(await isDealManualOnly(supa, "org-1"), false);
  // Se o fail-open fosse cacheado, um erro transitório desligaria a política da
  // org por 30s inteiros — e nesses 30s o ingest criaria Negócio à revelia.
  assertEquals(counter.n, 2);
});

Deno.test("cache é por org — uma org não decide pela outra", async () => {
  __resetDealPolicyCache();
  const perOrg: Record<string, Record<string, unknown>> = {
    "org-manual": { deal_manual_only: true },
    "org-normal": {},
  };
  let current = "";

  const build = (): FakeBuilder => {
    const builder: FakeBuilder = {
      select: () => builder,
      eq: (_column?: string, value?: string) => {
        if (value) current = value;
        return builder;
      },
      maybeSingle: () =>
        Promise.resolve({
          data: perOrg[current] ? { feature_flags: perOrg[current] } : null,
          error: null,
        }),
    };
    return builder;
  };
  const supa = { from: () => build() } as unknown as SupabaseClient;

  assertEquals(await isDealManualOnly(supa, "org-manual"), true);
  assertEquals(await isDealManualOnly(supa, "org-normal"), false);
  assertEquals(await isDealManualOnly(supa, "org-manual"), true);
});
