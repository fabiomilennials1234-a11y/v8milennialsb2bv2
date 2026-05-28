import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { DomainEvent, EventType } from "./types.ts";
import { handleLeadStageChanged } from "./handlers/lead-stage-changed.ts";

export type EventHandler = (
  supabase: SupabaseClient,
  event: DomainEvent,
) => Promise<void>;

/**
 * Registry central de handlers por event_type. Para registrar handler novo:
 *   1. Importar a função do handler
 *   2. Adicionar entrada abaixo (chave = event_type)
 *
 * Dispatcher (`dispatch.ts`) faz lookup aqui — eventos sem handler registrado
 * são marcados `failed` com erro explícito (não silenciar).
 */
export const handlers: Record<EventType, EventHandler> = {
  "lead.stage_changed": (supabase, event) =>
    handleLeadStageChanged(supabase, event as Extract<DomainEvent, { event_type: "lead.stage_changed" }>),
};

export function getHandler(eventType: string): EventHandler | null {
  return (handlers as Record<string, EventHandler>)[eventType] ?? null;
}
