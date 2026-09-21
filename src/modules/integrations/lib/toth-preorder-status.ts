import { z } from "zod";

const operationSchema = z.object({
  id: z.string().trim().min(1),
  draft_revision: z.number().int().positive(),
  delivery_state: z.enum(["queued", "sending", "awaiting_confirmation", "received", "failed", "blocked", "unknown"]).catch("unknown"),
  commercial_state: z.enum(["pending", "approved", "rejected", "unknown"]).catch("unknown"),
  reconciliation_state: z.enum(["not_due", "pending", "complete", "blocked", "unknown"]).catch("unknown"),
  external_id: z.string().trim().min(1).nullable(),
  approved_total: z.number().finite().nonnegative().nullable(),
  updated_at: z.string().datetime({ offset: true }),
  last_error_code: z.string().nullable(),
});

const workspaceSchema = z.object({
  can_send: z.boolean(),
  blockers: z.array(z.string()),
  operation: operationSchema.nullable(),
});

export type TothPreorderOperation = z.infer<typeof operationSchema>;
export type TothPreorderWorkspace = z.infer<typeof workspaceSchema>;

/** Unknown states stay unknown; a missing operation never becomes a receipt. */
export function parseTothPreorderWorkspace(value: unknown): TothPreorderWorkspace | null {
  const parsed = workspaceSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export interface TothPreorderStatus {
  label: string;
  description: string;
  secondaryLabel?: string;
  localNotice?: string;
  approvalConfirmed: boolean;
  destructive: boolean;
}

/** Receipt, business approval and local bookkeeping are separate facts. */
export function getTothPreorderStatus(operation: TothPreorderOperation): TothPreorderStatus {
  const base = { approvalConfirmed: false, destructive: false };
  switch (operation.delivery_state) {
    case "queued":
      return { ...base, label: "Aguardando envio", description: "A solicitação está registrada no CRM e ainda não foi confirmada pelo ERP." };
    case "sending":
      return { ...base, label: "Envio em andamento", description: "Aguarde a confirmação do recebimento pelo ERP." };
    case "awaiting_confirmation":
      return { ...base, label: "Aguardando confirmação", description: "O resultado do envio ainda é incerto. A operação precisa ser conferida antes de qualquer nova tentativa." };
    case "failed":
      return { ...base, destructive: true, label: "Falha no envio", description: "O envio não foi concluído. A situação precisa ser conferida antes de uma nova tentativa." };
    case "blocked":
      return { ...base, destructive: true, label: "Envio bloqueado", description: "Há uma pendência que impede o envio. Solicite a conferência de um administrador." };
    case "unknown":
      return { ...base, label: "Situação não confirmada", description: "Não há confirmação suficiente para informar o resultado desta operação." };
  }

  if (operation.commercial_state === "approved") {
    const localComplete = operation.reconciliation_state === "complete";
    return {
      ...base,
      approvalConfirmed: true,
      label: "Aprovado no ERP",
      description: localComplete
        ? "A aprovação do ERP foi registrada no CRM."
        : "A aprovação foi confirmada no ERP. A atualização do negócio no CRM ainda precisa ser concluída.",
      localNotice: localComplete ? undefined : operation.reconciliation_state === "blocked"
        ? "Atualização do CRM bloqueada. Solicite a conferência de um administrador."
        : "Atualização do CRM pendente. Não é necessário reenviar o pré-pedido.",
    };
  }
  if (operation.commercial_state === "rejected") {
    return { ...base, destructive: true, label: "Rejeitado no ERP", description: "O ERP rejeitou este pré-pedido. Solicite a conferência do motivo com o responsável." };
  }
  return {
    ...base,
    label: "Recebido no ERP",
    secondaryLabel: operation.commercial_state === "pending" ? "Em análise" : "Decisão não confirmada",
    description: "O recebimento ainda não confirma a aprovação comercial do pedido.",
  };
}
