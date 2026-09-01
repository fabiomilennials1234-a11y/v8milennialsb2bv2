/**
 * buildIdempotencyKey — o turno multi-foto.
 *
 * O cliente pede foto de vários produtos; o modelo emite uma `send_document`
 * por produto no MESMO turno (é o que `agent-engine-fallback.test.ts:187`
 * exercita, citando o bug "Forever Bella 2026-07-20 — só uma foto é enviada").
 * O parse sempre esteve certo: as extras saíam em `extraToolCalls`. Elas
 * morriam UMA CAMADA ABAIXO, na fila.
 *
 * `send_document` caía no ramo `default` da chave — `${actionType}_${leadId}_${turnOrTs}`,
 * SEM o `document_id`. A ação principal (agent-engine.ts:800) e as extras (:836)
 * passam o mesmo `turnCount`, então as N fotos do turno geravam a MESMA chave.
 * O índice único parcial `idx_pending_ai_actions_idempotency` rejeitava a 2ª
 * com 23505 e `ai-queue.ts:53-55` devolvia `{queued:false}` — silenciosamente.
 *
 * Evidência em prod (2026-09-01): 546 pares consecutivos de `send_document` e
 * NENHUM com menos de 2s de intervalo. Envio no mesmo turno é sub-segundo; a
 * ausência total dessa faixa é a marca de que as extras nunca chegavam à fila.
 */

import { describe, it, expect } from "vitest";
import { buildIdempotencyKey } from "../../supabase/functions/_shared/copilot/dispatcher.ts";

const ORG = "org-1";
const LEAD = "lead-1";

describe("buildIdempotencyKey — send_document", () => {
  it("gera chaves DIFERENTES para documentos diferentes no mesmo turno", () => {
    const a = buildIdempotencyKey("send_document", LEAD, ORG, { document_id: "doc-aaa" }, 7);
    const b = buildIdempotencyKey("send_document", LEAD, ORG, { document_id: "doc-bbb" }, 7);
    const c = buildIdempotencyKey("send_document", LEAD, ORG, { document_id: "doc-ccc" }, 7);

    expect(new Set([a, b, c]).size).toBe(3);
  });

  it("colapsa o MESMO documento repetido no mesmo turno (idempotência preservada)", () => {
    const a = buildIdempotencyKey("send_document", LEAD, ORG, { document_id: "doc-aaa" }, 7);
    const b = buildIdempotencyKey("send_document", LEAD, ORG, { document_id: "doc-aaa" }, 7);

    expect(a).toBe(b);
  });

  it("separa turnos diferentes para o mesmo documento", () => {
    const t7 = buildIdempotencyKey("send_document", LEAD, ORG, { document_id: "doc-aaa" }, 7);
    const t8 = buildIdempotencyKey("send_document", LEAD, ORG, { document_id: "doc-aaa" }, 8);

    expect(t7).not.toBe(t8);
  });

  it("separa leads diferentes", () => {
    const l1 = buildIdempotencyKey("send_document", "lead-1", ORG, { document_id: "doc-aaa" }, 7);
    const l2 = buildIdempotencyKey("send_document", "lead-2", ORG, { document_id: "doc-aaa" }, 7);

    expect(l1).not.toBe(l2);
  });

  it("regressão: a chave carrega o document_id (era o ramo default sem ele)", () => {
    const key = buildIdempotencyKey("send_document", LEAD, ORG, { document_id: "doc-aaa" }, 7);
    expect(key).toContain("doc-aaa");
  });

  it("não mexe nas outras ações — o ramo default segue como era", () => {
    const a = buildIdempotencyKey("send_product_material", LEAD, ORG, { document_id: "x" }, 7);
    const b = buildIdempotencyKey("send_product_material", LEAD, ORG, { document_id: "y" }, 7);
    expect(a).toBe(b);
    expect(a).toBe(`send_product_material_${LEAD}_t7`);
  });
});
