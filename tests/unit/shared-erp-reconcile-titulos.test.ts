/**
 * Tests for _shared/erp/sync/reconcile-titulos.ts — fecha os títulos que o ERP
 * Toth deixou de devolver (Chamado 065e4890).
 *
 * O Toth OMITE título quitado da resposta de `/cobrancas` — não devolve com saldo
 * 0. Sem reconciliação, título pago fica para sempre `aberto`/`atrasado` e o selo
 * "Inadimplente" soma dívida que não existe. O risco oposto é pior: resposta
 * errada fechando a carteira inteira. Os testes cobrem os dois lados.
 */
import { describe, it, expect } from "vitest";
import {
  reconcileMissingTitulos,
  tothBatchEvidence,
  RECONCILE_GUARD_MAX_RATIO,
  RECONCILE_GUARD_MIN_COUNT,
  type OpenTitulo,
  type TituloReconcileStore,
} from "../../supabase/functions/_shared/erp/sync/reconcile-titulos";

const ORG = "org-cafe";
const WINDOW = { from: "2026-08-30", to: "2026-11-28" };

function makeStore(open: OpenTitulo[]) {
  const calls = {
    list: [] as Array<{ organizationId: string; source: string; clientIds: string[] }>,
    paid: [] as string[][],
  };
  const store: TituloReconcileStore = {
    listOpenTitulosForClients: async (organizationId, source, clientIds) => {
      calls.list.push({ organizationId, source, clientIds });
      return open.filter((t) => clientIds.includes(t.clientId));
    },
    markTitulosPaid: async (_organizationId, ids) => {
      calls.paid.push([...ids]);
      return ids.length;
    },
  };
  return { store, calls };
}

const t = (id: string, externalId: string, vencimento: string | null, clientId = "c1"): OpenTitulo => ({
  id,
  externalId,
  vencimento,
  clientId,
});

const complete = (...ids: string[]) => ({ kind: "complete" as const, externalIds: new Set(ids) });

describe("reconcileMissingTitulos", () => {
  it("fecha como pago o título aberto AUSENTE cujo vencimento está dentro da janela", async () => {
    // O caso do cliente 14535: 108322 venceu 29/09 (dentro da janela), parou de
    // vir na resposta — foi pago. 109462 veio, segue aberto.
    const { store, calls } = makeStore([
      t("tit-a", "108322", "2026-09-29"),
      t("tit-b", "109462", "2026-10-29"),
    ]);

    const r = await reconcileMissingTitulos(store, {
      organizationId: ORG,
      source: "toth",
      clientIds: ["c1"],
      evidence: complete("109462"),
      window: WINDOW,
    });

    expect(r).toEqual({ action: "reconciled", closed: 1 });
    expect(calls.paid).toEqual([["tit-a"]]);
  });

  it("NÃO fecha ausente vencido ANTES da janela — a ausência ali não prova baixa", async () => {
    const { store, calls } = makeStore([
      t("tit-old", "107316", "2026-08-29"),
      t("tit-b", "109462", "2026-10-29"),
    ]);

    const r = await reconcileMissingTitulos(store, {
      organizationId: ORG,
      source: "toth",
      clientIds: ["c1"],
      evidence: complete("109462"),
      window: WINDOW,
    });

    expect(r).toEqual({ action: "reconciled", closed: 0 });
    expect(calls.paid).toEqual([]);
  });

  it("NÃO fecha ausente que vence DEPOIS da janela nem sem vencimento", async () => {
    const { store, calls } = makeStore([
      t("tit-future", "200", "2026-11-29"),
      t("tit-nodate", "201", null),
      t("tit-b", "109462", "2026-10-29"),
    ]);

    await reconcileMissingTitulos(store, {
      organizationId: ORG,
      source: "toth",
      clientIds: ["c1"],
      evidence: complete("109462"),
      window: WINDOW,
    });

    expect(calls.paid).toEqual([]);
  });

  it("inclui as bordas da janela", async () => {
    const { store, calls } = makeStore([
      t("tit-from", "1", WINDOW.from),
      t("tit-to", "2", WINDOW.to),
      t("k1", "3", "2026-10-01"),
      t("k2", "4", "2026-10-02"),
    ]);

    await reconcileMissingTitulos(store, {
      organizationId: ORG,
      source: "toth",
      clientIds: ["c1"],
      evidence: complete("3", "4"),
      window: WINDOW,
    });

    expect(calls.paid).toEqual([["tit-from", "tit-to"]]);
  });

  it("com full (sem janela) fecha todo ausente, inclusive o vencido há meses e o sem data", async () => {
    const { store, calls } = makeStore([
      t("tit-old", "107316", "2026-08-29"),
      t("tit-nodate", "201", null),
      t("k1", "109462", "2026-10-29"),
      t("k2", "109463", "2026-11-05"),
    ]);

    const r = await reconcileMissingTitulos(store, {
      organizationId: ORG,
      source: "toth",
      clientIds: ["c1"],
      evidence: complete("109462", "109463"),
      window: "full",
    });

    expect(r).toEqual({ action: "reconciled", closed: 2 });
    expect(calls.paid).toEqual([["tit-old", "tit-nodate"]]);
  });

  it("consulta só os clientes do lote e escreve UMA vez por lote", async () => {
    const { store, calls } = makeStore([
      t("a", "1", "2026-09-10", "c1"),
      t("b", "2", "2026-09-11", "c2"),
      t("keep1", "3", "2026-10-10", "c1"),
      t("keep2", "4", "2026-10-11", "c2"),
      t("other", "5", "2026-09-12", "c-fora-do-lote"),
    ]);

    await reconcileMissingTitulos(store, {
      organizationId: ORG,
      source: "toth",
      clientIds: ["c1", "c2"],
      evidence: complete("3", "4"),
      window: WINDOW,
    });

    expect(calls.list).toEqual([{ organizationId: ORG, source: "toth", clientIds: ["c1", "c2"] }]);
    expect(calls.paid).toEqual([["a", "b"]]);
  });

  it("🔴 lote sem evidência confiável NÃO fecha nada nem consulta o banco", async () => {
    const { store, calls } = makeStore([t("tit-a", "108322", "2026-09-29")]);

    const r = await reconcileMissingTitulos(store, {
      organizationId: ORG,
      source: "toth",
      clientIds: ["c1"],
      evidence: { kind: "untrusted", reason: "payload_not_array" },
      window: WINDOW,
    });

    expect(r).toEqual({ action: "skipped", reason: "payload_not_array" });
    expect(calls.list).toEqual([]);
    expect(calls.paid).toEqual([]);
  });

  it("lote sem clientes não consulta nada", async () => {
    const { store, calls } = makeStore([]);
    const r = await reconcileMissingTitulos(store, {
      organizationId: ORG,
      source: "toth",
      clientIds: [],
      evidence: complete(),
      window: WINDOW,
    });
    expect(r).toEqual({ action: "skipped", reason: "no_clients" });
    expect(calls.list).toEqual([]);
  });

  it(`🔴 trava: recusa fechar mais de ${RECONCILE_GUARD_MAX_RATIO * 100}% E mais de ${RECONCILE_GUARD_MIN_COUNT} títulos`, async () => {
    // Resposta truncada (ex.: o ERP honrou só o primeiro CNPJ do lote) parece
    // "todo mundo pagou". 21 de 21 abertos sumindo é sinal de resposta errada.
    const open = Array.from({ length: 21 }, (_, i) => t(`x${i}`, String(i), "2026-10-01"));
    const { store, calls } = makeStore(open);

    const r = await reconcileMissingTitulos(store, {
      organizationId: ORG,
      source: "toth",
      clientIds: ["c1"],
      evidence: complete(),
      window: WINDOW,
    });

    expect(r).toEqual({ action: "refused", wouldClose: 21, open: 21 });
    expect(calls.paid).toEqual([]);
  });

  it("trava não dispara com poucos títulos, mesmo a 100% (cliente que quitou tudo)", async () => {
    const open = Array.from({ length: 20 }, (_, i) => t(`x${i}`, String(i), "2026-10-01"));
    const { store, calls } = makeStore(open);

    const r = await reconcileMissingTitulos(store, {
      organizationId: ORG,
      source: "toth",
      clientIds: ["c1"],
      evidence: complete(),
      window: WINDOW,
    });

    expect(r).toEqual({ action: "reconciled", closed: 20 });
    expect(calls.paid[0]).toHaveLength(20);
  });

  it("trava não dispara com muitos títulos se a proporção é minoria", async () => {
    const closing = Array.from({ length: 25 }, (_, i) => t(`gone${i}`, `g${i}`, "2026-10-01"));
    const staying = Array.from({ length: 26 }, (_, i) => t(`kept${i}`, `k${i}`, "2026-10-01"));
    const { store, calls } = makeStore([...closing, ...staying]);

    const r = await reconcileMissingTitulos(store, {
      organizationId: ORG,
      source: "toth",
      clientIds: ["c1"],
      evidence: complete(...staying.map((s) => s.externalId)),
      window: WINDOW,
    });

    expect(r).toEqual({ action: "reconciled", closed: 25 });
    expect(calls.paid[0]).toHaveLength(25);
  });
});

describe("tothBatchEvidence — só resposta inequívoca prova ausência", () => {
  it("array válido com todos os ids mapeados → evidência completa", () => {
    const ev = tothBatchEvidence([{ id: "1" }, { id: "2" }], { externalIds: ["1", "2"], unmapped: 0 });
    expect(ev).toEqual({ kind: "complete", externalIds: new Set(["1", "2"]) });
  });

  it("array vazio é evidência válida: o lote não tem nada em aberto", () => {
    expect(tothBatchEvidence([], { externalIds: [], unmapped: 0 })).toEqual({
      kind: "complete",
      externalIds: new Set(),
    });
  });

  it("🔴 token expirado no corpo → não confiável", () => {
    const ev = tothBatchEvidence([{ error: "Acesso nao autorizado! " }], { externalIds: [], unmapped: 1 });
    expect(ev.kind).toBe("untrusted");
  });

  it("corpo com erro de negócio → não confiável", () => {
    expect(tothBatchEvidence({ erro: "Falha na consulta" }, { externalIds: [], unmapped: 0 }).kind).toBe(
      "untrusted",
    );
  });

  it("forma inesperada (objeto, envelope, string, null) → não confiável", () => {
    for (const payload of [{ data: [] }, { cobrancas: [{ id: "1" }] }, "ok", null, undefined, 42]) {
      expect(tothBatchEvidence(payload, { externalIds: [], unmapped: 0 }).kind).toBe("untrusted");
    }
  });

  it("linha que não é objeto → não confiável", () => {
    expect(tothBatchEvidence([{ id: "1" }, "lixo"], { externalIds: ["1"], unmapped: 0 }).kind).toBe(
      "untrusted",
    );
  });

  it("linha sem id mapeável → não confiável (o id dela pode ser o de um aberto)", () => {
    expect(tothBatchEvidence([{ id: "1" }, { valor: 10 }], { externalIds: ["1"], unmapped: 1 }).kind).toBe(
      "untrusted",
    );
  });
});
