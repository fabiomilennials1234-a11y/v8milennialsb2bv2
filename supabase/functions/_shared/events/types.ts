/**
 * Domain Events — type-safe contracts (slice 19 piloto).
 *
 * Cada evento é um snapshot imutável publicado em `domain_events`. Handler
 * registrado em `registry.ts` consome e dispara side-effects no módulo dono
 * da reação (não no emissor).
 *
 * Para adicionar evento novo:
 *   1. Definir interface tipada aqui (envelope + payload)
 *   2. Adicionar ao union `DomainEvent`
 *   3. Registrar handler em `registry.ts`
 */

export type EventType = "lead.stage_changed";

interface BaseEvent {
  event_type: EventType;
  aggregate_type: string;
  aggregate_id: string | null;
  organization_id: string;
  metadata?: Record<string, unknown>;
}

export interface LeadStageChangedPayload {
  lead_id: string;
  pipeline_id: string | null;
  campaign_id: string | null;
  pipe_type: string | null;
  old_stage_key: string | null;
  new_stage_key: string;
  pipeline_slug: string | null;
}

export interface LeadStageChangedEvent extends BaseEvent {
  event_type: "lead.stage_changed";
  aggregate_type: "pipeline_entry" | "campanha_lead";
  payload: LeadStageChangedPayload;
}

export type DomainEvent = LeadStageChangedEvent;

/**
 * Row shape de `domain_events` (subset usado pelo dispatcher).
 */
export interface DomainEventRow {
  id: string;
  organization_id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string | null;
  payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
  status: "pending" | "dispatched" | "failed";
  published_at: string;
  attempts: number;
}

export interface DispatchResult {
  scanned: number;
  dispatched: number;
  failed: number;
  errors: Array<{ id: string; event_type: string; error: string }>;
}
