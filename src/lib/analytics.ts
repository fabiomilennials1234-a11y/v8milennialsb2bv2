/**
 * Usage analytics — rastreia ações do usuário para identificar
 * organizações ativas, módulos mais usados e risco de churn.
 *
 * Nunca lança exceção — falhas são silenciadas para não quebrar o fluxo.
 */

import { supabase } from "@/integrations/supabase/client";

export type EventType =
  | "lead_created"
  | "lead_updated"
  | "card_moved"
  | "card_created"
  | "message_sent"
  | "automation_triggered"
  | "campaign_started"
  | "followup_created"
  | "import_started"
  | "import_completed"
  | "module_visited"
  | "onboarding_step_completed";

interface TrackParams {
  event: EventType;
  organizationId: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Registra um evento de uso na tabela usage_events.
 * Fire-and-forget: nunca bloqueia e nunca lança exceção.
 */
export function track(params: TrackParams): void {
  trackAsync(params).catch(() => {});
}

async function trackAsync(params: TrackParams): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || !params.organizationId) return;

    await supabase.from("usage_events").insert({
      organization_id: params.organizationId,
      user_id: user.id,
      event_type: params.event,
      entity_type: params.entityType ?? null,
      entity_id: params.entityId ?? null,
      metadata: params.metadata ?? null,
    });
  } catch {
    // Silencia — analytics nunca deve quebrar o fluxo do usuário
  }
}

/**
 * Hook helper para track de module_visited no useEffect de mount.
 * Uso: useTrackModuleVisit("leads", organizationId)
 */
export function trackModuleVisit(module: string, organizationId: string | null): void {
  if (!organizationId) return;
  track({
    event: "module_visited",
    organizationId,
    metadata: { module },
  });
}
