import { supabase } from "./client";

/**
 * Client-side event-bus wrapper (slice 19 event-bus piloto).
 *
 * Insere row em `domain_events` com status `pending` — a edge function
 * `event-dispatcher` (cron 1/min) faz fan-out para handlers registrados
 * em `supabase/functions/_shared/events/registry.ts`.
 *
 * Latência ponta-a-ponta: até ~60s (intervalo do cron). Aceitável para
 * workflows assíncronos. Para fluxos UX inline use mutation direto.
 *
 * Mirror tipado de `_shared/events/types.ts` — manter em sync ao adicionar
 * evento novo.
 */

export type LeadStageChangedPublishInput = {
  organization_id: string;
  /** ID do agregado (pipeline_entries.id ou campanha_leads.id) */
  aggregate_id: string;
  aggregate_type: "pipeline_entry" | "campanha_lead";
  payload: {
    lead_id: string;
    pipeline_id: string | null;
    campaign_id: string | null;
    pipe_type: string | null;
    old_stage_key: string | null;
    new_stage_key: string;
    pipeline_slug: string | null;
  };
  metadata?: Record<string, unknown>;
};

export type PublishEventInput =
  | (LeadStageChangedPublishInput & { event_type: "lead.stage_changed" });

/**
 * Publica evento de domínio. Resolve com event id, rejeita em INSERT failure.
 *
 * Call sites em fluxos não-críticos para UX devem usar `.catch(() => {})` para
 * não bloquear (consistente com o legacy `triggerStageChangedWorkflows`).
 */
export async function publishEvent(input: PublishEventInput): Promise<string> {
  const { event_type, organization_id, aggregate_id, aggregate_type, payload, metadata } = input;

  // Cast: `domain_events` é introduzido na migration 20261105000000 e não
  // está em types.ts até regen pós-apply em dev. Cast removível quando
  // types forem atualizados.
  const client = supabase as unknown as {
    from: (table: string) => {
      insert: (row: Record<string, unknown>) => {
        select: (cols: string) => {
          single: () => Promise<{ data: { id: string } | null; error: { message: string } | null }>;
        };
      };
    };
  };

  const { data, error } = await client
    .from("domain_events")
    .insert({
      organization_id,
      event_type,
      aggregate_type,
      aggregate_id,
      payload,
      metadata: metadata ?? {},
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`publishEvent failed (${event_type}): ${error?.message ?? "no row returned"}`);
  }

  return data.id;
}
