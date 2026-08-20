/**
 * Tests for _shared/erp/sync/bulk-create-clients.ts.
 *
 * O que se trava aqui é o que faz a criação em lote ser SEGURA, não só rápida:
 * o vínculo lead↔cliente não depender de ordem, e uma falha no meio não deixar
 * lead órfão para trás.
 */
import { describe, it, expect, vi } from "vitest";
import {
  buildClientRows,
  chunk,
  bulkCreateClients,
} from "../../supabase/functions/_shared/erp/sync/bulk-create-clients";
import type { CanonicalClient } from "../../supabase/functions/_shared/erp/types";

const cliente = (id: string): CanonicalClient => ({
  externalId: id,
  externalRef: null,
  cnpj: `1122233300014${id.slice(-1)}`,
  name: `CLIENTE ${id}`,
  company: null,
  email: null,
  phone: null,
});

/** Supabase mínimo: registra as chamadas e devolve o erro programado. */
function fakeAdmin(errors: Record<string, { message: string } | null> = {}) {
  const calls: Array<{ table: string; op: string; rows?: unknown[]; ids?: unknown }> = [];
  const admin = {
    from(table: string) {
      return {
        insert(rows: unknown[]) {
          calls.push({ table, op: "insert", rows });
          return Promise.resolve({ error: errors[table] ?? null });
        },
        delete() {
          return {
            in(_col: string, ids: unknown) {
              calls.push({ table, op: "delete", ids });
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
  return { admin, calls };
}

describe("buildClientRows — o vínculo não depende de ordem", () => {
  it("🔑 o id do lead é gerado antes e reaproveitado no cliente", () => {
    // A alternativa seria ler os ids de volta com RETURNING e casar pela ordem.
    // Quando essa ordem falha, o cliente A fica com o lead do B — sem erro.
    const { lead, carteira } = buildClientRows("org-1", "toth", cliente("293"), "uuid-fixo");
    expect(lead.id).toBe("uuid-fixo");
    expect(carteira.lead_id).toBe("uuid-fixo");
  });

  it("carimba a origem do provider no lead e a identidade externa no cliente", () => {
    const { lead, carteira } = buildClientRows("org-1", "toth", cliente("293"), "u1");
    expect(lead.origin).toBe("erp_toth");
    expect(carteira.external_source).toBe("toth");
    expect(carteira.external_id).toBe("293");
    expect(carteira.is_active).toBe(true);
    expect(carteira.organization_id).toBe("org-1");
  });
});

describe("chunk", () => {
  it("divide no tamanho pedido", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("tamanho inválido vira lote único, sem laço infinito", () => {
    expect(chunk([1, 2], 0)).toEqual([[1, 2]]);
    expect(chunk([], 0)).toEqual([]);
  });
});

describe("bulkCreateClients", () => {
  const tres = [cliente("1"), cliente("2"), cliente("3")];
  const ids = () => {
    let n = 0;
    return () => `uuid-${++n}`;
  };

  it("faz DOIS statements por lote, não dois por cliente", async () => {
    const { admin, calls } = fakeAdmin();
    const r = await bulkCreateClients(admin as never, {
      organizationId: "org-1",
      source: "toth",
      clients: tres,
      batchSize: 500,
      newId: ids(),
    });

    expect(r.created).toBe(3);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ table: "leads", op: "insert" });
    expect(calls[0].rows).toHaveLength(3);
    expect(calls[1]).toMatchObject({ table: "upsell_clients", op: "insert" });
  });

  it("respeita o tamanho do lote", async () => {
    const { admin, calls } = fakeAdmin();
    await bulkCreateClients(admin as never, {
      organizationId: "org-1",
      source: "toth",
      clients: tres,
      batchSize: 2,
      newId: ids(),
    });
    // 2 lotes × 2 statements
    expect(calls).toHaveLength(4);
  });

  it("🔴 falha ao criar clientes APAGA os leads do lote", async () => {
    // Lead sem cliente é órfão invisível: não aparece na carteira, mas conta na
    // lista de Leads e já adotou conversas órfãs pelo gatilho.
    const { admin, calls } = fakeAdmin({ upsell_clients: { message: "boom" } });
    const r = await bulkCreateClients(admin as never, {
      organizationId: "org-1",
      source: "toth",
      clients: tres,
      newId: ids(),
    });

    expect(r.created).toBe(0);
    expect(r.failed).toBe(3);
    const del = calls.find((c) => c.op === "delete");
    expect(del?.table).toBe("leads");
    expect(del?.ids).toEqual(["uuid-1", "uuid-2", "uuid-3"]);
  });

  it("falha ao criar leads não tenta criar clientes nem apagar nada", async () => {
    const { admin, calls } = fakeAdmin({ leads: { message: "boom" } });
    const r = await bulkCreateClients(admin as never, {
      organizationId: "org-1",
      source: "toth",
      clients: tres,
      newId: ids(),
    });

    expect(r.failed).toBe(3);
    expect(calls.filter((c) => c.table === "upsell_clients")).toHaveLength(0);
    expect(calls.filter((c) => c.op === "delete")).toHaveLength(0);
  });

  it("um lote quebrado não derruba os outros", async () => {
    // Só o primeiro insert de leads falha; o segundo lote segue.
    let chamada = 0;
    const admin = {
      from(table: string) {
        return {
          insert() {
            chamada++;
            const falha = table === "leads" && chamada === 1;
            return Promise.resolve({ error: falha ? { message: "boom" } : null });
          },
          delete: () => ({ in: () => Promise.resolve({ error: null }) }),
        };
      },
    };

    const r = await bulkCreateClients(admin as never, {
      organizationId: "org-1",
      source: "toth",
      clients: [cliente("1"), cliente("2")],
      batchSize: 1,
      newId: ids(),
    });

    expect(r.failed).toBe(1);
    expect(r.created).toBe(1);
    expect(r.errors[0]).toContain("leads");
  });

  it("lista vazia não toca no banco", async () => {
    const { admin, calls } = fakeAdmin();
    const r = await bulkCreateClients(admin as never, {
      organizationId: "org-1",
      source: "toth",
      clients: [],
    });
    expect(r).toEqual({ created: 0, failed: 0, errors: [] });
    expect(calls).toHaveLength(0);
  });
});
