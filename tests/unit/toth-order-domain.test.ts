import { describe, expect, it } from "vitest";
import {
  getTothOrderBlockerLabel,
  getTothOrderReviewAvailability,
  getTothOrderSendAvailability,
  isTothOrderDraftPilot,
  isTothOrderReviewCurrent,
  TOTH_ORDER_PILOT_ORG_ID,
  validateTothOrderDraftInput,
  type TothOrderDraft,
  type TothOrderWorkspace,
} from "../../src/modules/integrations/lib/toth-order-domain";

const draft: TothOrderDraft = {
  id: "draft-1",
  deal_id: "deal-1",
  revision: 3,
  items: [{ product_external_id: "000123", quantity: 2.5 }],
  notes: "Conferir embalagem.",
  reviewed_revision: 3,
  reviewed_at: "2026-09-17T12:00:00.000Z",
  reviewed_by: "admin-1",
  created_at: "2026-09-17T11:00:00.000Z",
  updated_at: "2026-09-17T11:30:00.000Z",
};

const workspace: TothOrderWorkspace = {
  enabled: true,
  can_prepare: true,
  can_review: true,
  draft,
  audit: [],
  catalog: [{ product_external_id: "000123", description: "Café" }],
  blockers: [],
};

describe("visibilidade do piloto de rascunhos", () => {
  it("exige a organização da Café Jurerê e flag estritamente booleana", () => {
    expect(isTothOrderDraftPilot(TOTH_ORDER_PILOT_ORG_ID, true)).toBe(true);
    for (const enabled of [false, undefined, null, "true", 1, {}, []]) {
      expect(isTothOrderDraftPilot(TOTH_ORDER_PILOT_ORG_ID, enabled)).toBe(false);
    }
    for (const organizationId of ["outra-organização", "", null, undefined]) {
      expect(isTothOrderDraftPilot(organizationId, true)).toBe(false);
    }
  });
});

describe("rascunhos locais de pedidos Toth", () => {
  it("preserva códigos opacos com zeros iniciais e quantidades fracionárias", () => {
    expect(validateTothOrderDraftInput({ items: draft.items, notes: draft.notes })).toEqual({
      success: true,
      data: { items: [{ product_external_id: "000123", quantity: 2.5 }], notes: draft.notes },
    });
  });

  it("permite preparação vazia sem inventar produtos e preenche observação opcional", () => {
    expect(validateTothOrderDraftInput({ items: [] })).toEqual({
      success: true,
      data: { items: [], notes: "" },
    });
  });

  it.each(["", " ", " 123", "123 ", "abc\n123", "abc\u0000123", "a".repeat(129), 123, null])(
    "rejeita código inválido: %j", (product_external_id) => {
      expect(validateTothOrderDraftInput({ items: [{ product_external_id, quantity: 1 }] }).success)
        .toBe(false);
    },
  );

  it.each([0, -1, NaN, Infinity, -Infinity, 1_000_000_001, "2", null])(
    "rejeita quantidade inválida: %j", (quantity) => {
      expect(validateTothOrderDraftInput({ items: [{ product_external_id: "123", quantity }] }).success)
        .toBe(false);
    },
  );

  it("rejeita linhas duplicadas em vez de somar ou sobrescrever silenciosamente", () => {
    const result = validateTothOrderDraftInput({ items: [...draft.items, ...draft.items] });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues[0].path).toBe("items.1.product_external_id");
  });

  it("rejeita preço, desconto, cliente ou condição livre no payload", () => {
    for (const field of ["price", "discount", "client_id", "payment_condition"]) {
      expect(validateTothOrderDraftInput({ items: draft.items, [field]: "arbitrário" }).success)
        .toBe(false);
      expect(validateTothOrderDraftInput({ items: [{ ...draft.items[0], [field]: "arbitrário" }] }).success)
        .toBe(false);
    }
  });

  it("limita observações e linhas para impedir payloads excessivos", () => {
    expect(validateTothOrderDraftInput({ items: [], notes: "a".repeat(1000) }).success).toBe(true);
    expect(validateTothOrderDraftInput({ items: [], notes: "a".repeat(1001) }).success).toBe(false);
    const items = Array.from({ length: 201 }, (_, index) => ({ product_external_id: `${index}`, quantity: 1 }));
    expect(validateTothOrderDraftInput({ items: items.slice(0, 200) }).success).toBe(true);
    expect(validateTothOrderDraftInput({ items }).success).toBe(false);
  });

  it.each([null, undefined, [], "pedido", { items: null }, { items: [{}] }])(
    "rejeita estrutura incompleta sem lançar exceção: %j", (input) => {
      expect(validateTothOrderDraftInput(input).success).toBe(false);
    },
  );
});

describe("revisão preparatória versionada", () => {
  it("reconhece somente a versão efetivamente revisada", () => {
    expect(isTothOrderReviewCurrent(draft)).toBe(true);
    expect(isTothOrderReviewCurrent({ ...draft, revision: 4 })).toBe(false);
    expect(isTothOrderReviewCurrent({ ...draft, reviewed_revision: 4 })).toBe(false);
  });

  it("não aceita revisão incompleta ou sem autoria/data", () => {
    expect(isTothOrderReviewCurrent(null)).toBe(false);
    expect(isTothOrderReviewCurrent({ ...draft, reviewed_revision: null })).toBe(false);
    expect(isTothOrderReviewCurrent({ ...draft, reviewed_by: null })).toBe(false);
    expect(isTothOrderReviewCurrent({ ...draft, reviewed_at: null })).toBe(false);
    expect(isTothOrderReviewCurrent({ ...draft, reviewed_at: "não é data" })).toBe(false);
    expect(isTothOrderReviewCurrent({ ...draft, revision: 0, reviewed_revision: 0 })).toBe(false);
  });

  it("permite revisão local com acesso de administrador e produto disponível", () => {
    expect(getTothOrderReviewAvailability(workspace)).toEqual({ allowed: true, blockers: [] });
  });

  it("não confunde permissão de preparação com revisão de administrador", () => {
    const result = getTothOrderReviewAvailability({ ...workspace, can_review: false });
    expect(result.allowed).toBe(false);
    expect(result.blockers).toContain("admin_required");
  });

  it("bloqueia revisão quando preparação está desabilitada", () => {
    expect(getTothOrderReviewAvailability({ ...workspace, enabled: false }).allowed).toBe(false);
  });

  it.each(["client_link_unavailable", "client_link_changed"])(
    "bloqueia revisão por vínculo do cliente mesmo para administrador: %s", (blocker) => {
      const result = getTothOrderReviewAvailability({ ...workspace, blockers: [blocker] });
      expect(result.allowed).toBe(false);
      expect(result.blockers).toContain(blocker);
    },
  );

  it("bloqueia rascunho vazio, catálogo ausente ou produto removido do catálogo", () => {
    expect(getTothOrderReviewAvailability({ ...workspace, draft: null }).blockers).toContain("draft_missing");
    expect(getTothOrderReviewAvailability({ ...workspace, draft: { ...draft, items: [] } }).blockers)
      .toContain("items_required");
    expect(getTothOrderReviewAvailability({ ...workspace, catalog: [] }).blockers)
      .toContain("catalog_unavailable");
    expect(getTothOrderReviewAvailability({
      ...workspace,
      catalog: [{ product_external_id: "other", description: "Outro produto" }],
    }).blockers).toContain("catalog_item_unavailable");
  });
});

describe("escrita Toth indisponível nesta fundação", () => {
  it("mantém envio bloqueado mesmo com administrador, catálogo e revisão válida", () => {
    const result = getTothOrderSendAvailability(workspace);
    expect(result.allowed).toBe(false);
    expect(result.blockers).toEqual(expect.arrayContaining([
      "supplier_contract_unverified",
      "homologation_unverified",
      "commercial_validation_unavailable",
      "writes_disabled",
    ]));
    expect(result.blockers).not.toContain("catalog_unavailable");
    expect(result.blockers).not.toContain("review_required");
  });

  it("inclui bloqueios retornados pelo servidor e revisão obsoleta sem duplicá-los", () => {
    const result = getTothOrderSendAvailability({
      ...workspace,
      draft: { ...draft, revision: 4 },
      blockers: ["writes_disabled", "customer_link_ambiguous"],
    });
    expect(result.allowed).toBe(false);
    expect(result.blockers).toContain("customer_link_ambiguous");
    expect(result.blockers).toContain("review_required");
    expect(result.blockers.filter((code) => code === "writes_disabled")).toHaveLength(1);
  });

  it("explica bloqueios conhecidos e trata códigos desconhecidos sem expor texto arbitrário", () => {
    expect(getTothOrderBlockerLabel("writes_disabled")).toContain("indisponível");
    expect(getTothOrderBlockerLabel("untrusted-server-details")).toBe("Há uma validação pendente para esta operação.");
    expect(getTothOrderBlockerLabel("constructor")).toBe("Há uma validação pendente para esta operação.");
  });
});
