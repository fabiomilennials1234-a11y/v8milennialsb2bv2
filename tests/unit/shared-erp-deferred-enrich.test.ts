/**
 * Fila de enriquecimento com escrita em paralelo.
 *
 * Existe porque as colunas `erp_*` nascem NULL: na Café Jurerê, 11.179 clientes
 * já existentes passam a mudar de verdade, e 11.179 UPDATEs sequenciais estouram
 * o teto de 150s do gateway.
 */
import { describe, it, expect } from "vitest";
import { deferredEnrichStore } from "../../supabase/functions/_shared/erp/sync/deferred-enrich-store";
import type { ClientStore } from "../../supabase/functions/_shared/erp/sync/upsert-client";

function innerStore() {
  const escritas: Array<{ id: string; patch: Record<string, unknown> }> = [];
  let emVoo = 0;
  let picoDeConcorrencia = 0;

  const store: ClientStore = {
    findByExternalId: () => Promise.resolve(null),
    findByCnpj: () => Promise.resolve(null),
    createLead: () => Promise.resolve("lead-1"),
    createClient: () => Promise.resolve("client-1"),
    enrich: async (id, patch) => {
      emVoo++;
      picoDeConcorrencia = Math.max(picoDeConcorrencia, emVoo);
      await new Promise((r) => setTimeout(r, 1));
      escritas.push({ id, patch });
      emVoo--;
    },
  };
  return { store, escritas, pico: () => picoDeConcorrencia };
}

describe("deferredEnrichStore", () => {
  it("não escreve nada até o flush", async () => {
    const inner = innerStore();
    const { store, pending } = deferredEnrichStore(inner.store);

    await store.enrich("c-1", { erp_owner_name: "MARIA" });
    await store.enrich("c-2", { erp_owner_name: "JOAO" });

    expect(inner.escritas).toHaveLength(0);
    expect(pending()).toBe(2);
  });

  it("aplica tudo no flush e devolve a contagem", async () => {
    const inner = innerStore();
    const { store, flush, pending } = deferredEnrichStore(inner.store);

    for (let i = 0; i < 50; i++) await store.enrich(`c-${i}`, { erp_uf: "SC" });
    const r = await flush(10);

    expect(r).toEqual({ applied: 50, failed: 0, errors: [] });
    expect(inner.escritas).toHaveLength(50);
    expect(pending()).toBe(0);
  });

  it("respeita o teto de concorrência", async () => {
    const inner = innerStore();
    const { store, flush } = deferredEnrichStore(inner.store);

    for (let i = 0; i < 40; i++) await store.enrich(`c-${i}`, { erp_uf: "SC" });
    await flush(5);

    expect(inner.pico()).toBeLessThanOrEqual(5);
    expect(inner.pico()).toBeGreaterThan(1);
  });

  it("🔑 funde patches do mesmo cliente — um UPDATE, não dois fora de ordem", async () => {
    // O ERP devolve cadastros distintos com o mesmo CNPJ. Dois patches na fila
    // virariam dois UPDATEs na mesma linha, aplicados na ordem do pool — que
    // não é a ordem de leitura.
    const inner = innerStore();
    const { store, flush } = deferredEnrichStore(inner.store);

    await store.enrich("c-1", { erp_owner_name: "MARIA", erp_uf: "SC" });
    await store.enrich("c-1", { erp_owner_name: "JOAO" });
    await flush();

    expect(inner.escritas).toEqual([
      { id: "c-1", patch: { erp_owner_name: "JOAO", erp_uf: "SC" } },
    ]);
  });

  it("falha de uma escrita não derruba as outras", async () => {
    const inner = innerStore();
    const original = inner.store.enrich;
    inner.store.enrich = (id, patch) =>
      id === "c-2" ? Promise.reject(new Error("boom")) : original(id, patch);

    const { store, flush } = deferredEnrichStore(inner.store);
    for (const id of ["c-1", "c-2", "c-3"]) await store.enrich(id, { erp_uf: "SC" });
    const r = await flush(2);

    expect(r.applied).toBe(2);
    expect(r.failed).toBe(1);
    expect(r.errors).toEqual(["boom"]);
  });

  it("guarda no máximo 3 erros — onze mil mensagens iguais afogam o log", async () => {
    const inner = innerStore();
    inner.store.enrich = () => Promise.reject(new Error("falhou"));

    const { store, flush } = deferredEnrichStore(inner.store);
    for (let i = 0; i < 20; i++) await store.enrich(`c-${i}`, { erp_uf: "SC" });
    const r = await flush(4);

    expect(r.failed).toBe(20);
    expect(r.errors).toHaveLength(3);
  });

  it("leitura e criação continuam indo direto ao store real", async () => {
    const inner = innerStore();
    const { store } = deferredEnrichStore(inner.store);

    await expect(store.findByExternalId("org", "1")).resolves.toBeNull();
    await expect(store.createLead("org", { name: "X", company: null, phone: null, email: null }))
      .resolves.toBe("lead-1");
    await expect(store.createClient({})).resolves.toBe("client-1");
  });
});
