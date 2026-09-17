import { z } from "zod";

export const TOTH_ORDER_PILOT_ORG_ID = "4922638c-4909-494e-ba10-12282ec0b161";
export const TOTH_ORDER_DRAFTS_FLAG = "toth_order_drafts";

/** UI visibility only; the server also checks the organization and flag. */
export function isTothOrderDraftPilot(organizationId: string | null | undefined, enabled: unknown): boolean {
  return organizationId === TOTH_ORDER_PILOT_ORG_ID && enabled === true;
}

/** Local preparation only. These types do not describe a Toth write API. */
export interface TothOrderItem {
  product_external_id: string;
  quantity: number;
}

export interface TothOrderDraftInput {
  items: TothOrderItem[];
  notes: string;
}

export interface TothOrderDraft extends TothOrderDraftInput {
  id: string;
  deal_id: string;
  revision: number;
  reviewed_revision: number | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TothOrderAuditEntry {
  id: string;
  action: string;
  revision: number;
  actor_id: string | null;
  actor_name?: string | null;
  created_at: string;
}

export interface TothOrderCatalogItem {
  product_external_id: string;
  description: string;
}

export interface TothOrderWorkspace {
  enabled: boolean;
  can_prepare: boolean;
  can_review: boolean;
  draft: TothOrderDraft | null;
  audit: TothOrderAuditEntry[];
  catalog: TothOrderCatalogItem[];
  blockers: string[];
}

export const TOTH_ORDER_DRAFT_LIMITS = Object.freeze({
  items: 200,
  notes: 1000,
  productExternalId: 128,
  quantity: 1_000_000_000,
});

const itemSchema = z.object({
  product_external_id: z.string()
    .min(1, "Selecione um produto do catálogo do ERP.")
    .max(TOTH_ORDER_DRAFT_LIMITS.productExternalId, "Código de produto inválido.")
    .refine((value) => value.trim() === value && value.trim().length > 0,
      "Código de produto inválido.")
    .refine((value) => !/\p{Cc}/u.test(value), "Código de produto inválido."),
  quantity: z.number()
    .finite("Informe uma quantidade válida.")
    .positive("A quantidade deve ser maior que zero.")
    .max(TOTH_ORDER_DRAFT_LIMITS.quantity, "Quantidade acima do limite do rascunho."),
}).strict();

const draftInputSchema = z.object({
  // Empty drafts are useful before the supplier catalog is available. They
  // cannot be reviewed or sent; no local placeholder becomes an ERP product.
  items: z.array(itemSchema).max(TOTH_ORDER_DRAFT_LIMITS.items, "Limite de itens excedido."),
  notes: z.string().max(TOTH_ORDER_DRAFT_LIMITS.notes, "Use no máximo 1.000 caracteres.").default(""),
}).strict().superRefine((draft, context) => {
  const seen = new Set<string>();
  draft.items.forEach((item, index) => {
    if (seen.has(item.product_external_id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["items", index, "product_external_id"],
        message: "O produto já está no rascunho. Ajuste a quantidade do item existente.",
      });
    }
    seen.add(item.product_external_id);
  });
});

export type TothOrderDraftValidation =
  | { success: true; data: TothOrderDraftInput }
  | { success: false; issues: { path: string; message: string }[] };

/** UI validation is advisory; authorization and catalog membership live in SQL. */
export function validateTothOrderDraftInput(input: unknown): TothOrderDraftValidation {
  const result = draftInputSchema.safeParse(input);
  if (result.success) return { success: true, data: result.data };
  return {
    success: false,
    issues: result.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  };
}

export function isTothOrderReviewCurrent(draft: TothOrderDraft | null): boolean {
  return !!draft
    && Number.isSafeInteger(draft.revision)
    && draft.revision > 0
    && draft.reviewed_revision === draft.revision
    && !!draft.reviewed_by?.trim()
    && !!draft.reviewed_at
    && Number.isFinite(Date.parse(draft.reviewed_at));
}

const BLOCKER_LABELS: Record<string, string> = {
  supplier_contract_unverified: "Contrato de escrita do Toth ainda não validado.",
  homologation_unverified: "Homologação da escrita no ERP ainda não concluída.",
  commercial_validation_unavailable: "Validação de preços e regras comerciais do ERP indisponível.",
  writes_disabled: "Envio ao ERP indisponível nesta etapa.",
  catalog_unavailable: "Catálogo de produtos do ERP ainda indisponível.",
  catalog_item_unavailable: "Há produtos que não estão disponíveis no catálogo do ERP.",
  preparation_disabled: "Preparação de pedidos ainda não habilitada para esta organização.",
  drafts_disabled: "Preparação de pedidos ainda não habilitada para esta organização.",
  client_link_unavailable: "O negócio precisa de um vínculo válido e único com um cliente do Toth.",
  client_link_changed: "O vínculo do cliente mudou. A preparação está bloqueada para conferência.",
  admin_required: "Somente administradores da organização podem revisar e enviar pedidos.",
  draft_missing: "Salve um rascunho vinculado ao negócio.",
  draft_invalid: "Corrija os dados do rascunho antes de revisar.",
  items_required: "Inclua ao menos um produto do catálogo do ERP.",
  review_required: "A versão atual do rascunho precisa ser revisada.",
};

export function getTothOrderBlockerLabel(code: string): string {
  return Object.prototype.hasOwnProperty.call(BLOCKER_LABELS, code)
    ? BLOCKER_LABELS[code]
    : "Há uma validação pendente para esta operação.";
}

/** A preparatory review is local; it does not validate prices or authorize ERP writes. */
export function getTothOrderReviewAvailability(workspace: TothOrderWorkspace): {
  allowed: boolean;
  blockers: string[];
} {
  const blockers: string[] = [];
  if (!workspace.enabled) blockers.push("preparation_disabled");
  if (!workspace.can_review) blockers.push("admin_required");
  if (!workspace.catalog.length) blockers.push("catalog_unavailable");
  for (const blocker of ["client_link_unavailable", "client_link_changed"]) {
    if (workspace.blockers.includes(blocker)) blockers.push(blocker);
  }

  if (!workspace.draft) {
    blockers.push("draft_missing");
  } else {
    const { items, notes } = workspace.draft;
    if (!validateTothOrderDraftInput({ items, notes }).success) blockers.push("draft_invalid");
    if (!items.length) blockers.push("items_required");
    const catalogIds = new Set(workspace.catalog.map((item) => item.product_external_id));
    if (items.some((item) => !catalogIds.has(item.product_external_id))) {
      blockers.push("catalog_item_unavailable");
    }
  }

  return { allowed: blockers.length === 0, blockers };
}

/**
 * Deliberately no configurable write switch or network transport. Even a
 * reviewed draft must stay blocked until a verified supplier adapter is built.
 * The server independently enforces the same prohibition.
 */
export function getTothOrderSendAvailability(workspace: TothOrderWorkspace): {
  allowed: false;
  blockers: string[];
} {
  const blockers = new Set([
    "supplier_contract_unverified",
    "homologation_unverified",
    "commercial_validation_unavailable",
    "writes_disabled",
    ...workspace.blockers,
    ...getTothOrderReviewAvailability(workspace).blockers,
  ]);
  if (!isTothOrderReviewCurrent(workspace.draft)) blockers.add("review_required");
  return { allowed: false, blockers: [...blockers] };
}
