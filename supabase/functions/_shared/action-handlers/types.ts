import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface ActionInput {
  supabase: SupabaseClient;
  organizationId: string;
  leadId: string | null;
  /**
   * ── O SUJEITO DA AUTOMAÇÃO NÃO É SÓ A PESSOA ──────────────────────────────
   * ADR-0023 §1: o Negócio, não o Lead, é o que se move por um Pipeline — e o
   * Lead **nunca tem etapa**. Enquanto este contrato só tinha `leadId`, toda
   * ação de funil era obrigada a falar da pessoa e depois ADIVINHAR de qual
   * Negócio se tratava (`pickActiveEntry`: "o aberto, senão o mais recente").
   *
   * `entryId` é `pipeline_entries.id` — a POSIÇÃO, o card que se move
   * (ADR-0023 §5). É ele, e não `dealId`, o sujeito: 26% dos cards em produção
   * não têm linha em `deals` (medido 2026-08-25), e nos criados desde 24/08 a
   * proporção passa de 97%. Chavear em `deals` deixaria a automação cega para
   * a maioria do que entra no funil.
   *
   * Nulo quando o gatilho é da PESSOA (`lead_created`, `tag_added`) — aí não há
   * negócio a que se referir, e a ação de funil volta ao critério de sempre.
   */
  entryId: string | null;
  /** `deals.id` — identidade e dinheiro. Viaja junto quando a entrada tem. */
  dealId: string | null;
  conversationId: string | null;
  params: Record<string, unknown>;
  /** Workflow execution context — carries variables from upstream nodes. */
  executionContext?: Record<string, unknown>;
}

export interface ActionResult {
  success: boolean;
  message?: string;
  error?: string;
  data?: Record<string, unknown>;
  retryable?: boolean;
}

export type ActionHandler = (input: ActionInput) => Promise<ActionResult>;
