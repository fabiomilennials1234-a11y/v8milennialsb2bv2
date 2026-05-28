import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { DomainEvent } from "./types.ts";

/**
 * Publica um evento de domínio. Insere row em `domain_events` com status
 * `pending` — o dispatcher (cron 1/min) faz fan-out para handlers registrados.
 *
 * Retorna o ID do evento publicado. Lança em caso de erro de INSERT — call
 * site decide se trata como blocking ou fire-and-forget.
 */
export async function publishEvent(
  supabase: SupabaseClient,
  event: DomainEvent,
): Promise<string> {
  const { data, error } = await supabase
    .from("domain_events")
    .insert({
      organization_id: event.organization_id,
      event_type: event.event_type,
      aggregate_type: event.aggregate_type,
      aggregate_id: event.aggregate_id,
      payload: event.payload,
      metadata: event.metadata ?? {},
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(`publishEvent failed (${event.event_type}): ${error.message}`);
  }

  return data.id as string;
}
