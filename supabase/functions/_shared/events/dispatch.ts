import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logEvent } from "../error-boundary.ts";
import { getHandler } from "./registry.ts";
import type { DispatchResult, DomainEvent, DomainEventRow } from "./types.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

interface DispatchOptions {
  batchSize?: number;
  /** Override Supabase client for tests. */
  supabase?: SupabaseClient;
}

/**
 * Busca eventos pending em ordem cronológica, executa handler registrado por
 * event_type, marca status final. Erros de handler aterrissam em
 * `last_error` + status `failed` (sem retry automático nesta versão — replay
 * manual via reset de status).
 */
export async function dispatchPending(
  options: DispatchOptions = {},
): Promise<DispatchResult> {
  const batchSize = options.batchSize ?? 50;
  // `autoRefreshToken: false`: senão o auth-js arma um `setInterval` de 30 s por
  // cliente e ninguém o desarma. Ver `_shared/supabase-admin.ts`.
  const supabase = options.supabase ??
    createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

  const result: DispatchResult = {
    scanned: 0,
    dispatched: 0,
    failed: 0,
    errors: [],
  };

  const { data: pending, error: queryError } = await supabase
    .from("domain_events")
    .select("id, organization_id, event_type, aggregate_type, aggregate_id, payload, metadata, status, published_at, attempts")
    .eq("status", "pending")
    .order("published_at", { ascending: true })
    .limit(batchSize);

  if (queryError) {
    throw new Error(`dispatchPending query failed: ${queryError.message}`);
  }

  const rows = (pending ?? []) as DomainEventRow[];
  result.scanned = rows.length;

  for (const row of rows) {
    const handler = getHandler(row.event_type);

    if (!handler) {
      await markFailed(supabase, row, `No handler registered for event_type=${row.event_type}`);
      result.failed++;
      result.errors.push({ id: row.id, event_type: row.event_type, error: "no-handler" });
      continue;
    }

    const event = rowToEvent(row);

    try {
      await handler(supabase, event);
      await markDispatched(supabase, row);
      result.dispatched++;

      // Observability: tag event_type for breadcrumb-like metrics.
      await logEvent(`event-dispatched`, {
        functionName: "event-dispatcher",
        organizationId: row.organization_id,
        tags: { event_type: row.event_type },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await markFailed(supabase, row, message);
      result.failed++;
      result.errors.push({ id: row.id, event_type: row.event_type, error: message });
    }
  }

  return result;
}

async function markDispatched(supabase: SupabaseClient, row: DomainEventRow): Promise<void> {
  await supabase
    .from("domain_events")
    .update({
      status: "dispatched",
      dispatched_at: new Date().toISOString(),
      attempts: row.attempts + 1,
      last_error: null,
    })
    .eq("id", row.id);
}

async function markFailed(
  supabase: SupabaseClient,
  row: DomainEventRow,
  error: string,
): Promise<void> {
  await supabase
    .from("domain_events")
    .update({
      status: "failed",
      attempts: row.attempts + 1,
      last_error: error.slice(0, 2000),
    })
    .eq("id", row.id);
}

/**
 * Fronteira de confiança: `payload` chega como JSONB (`Record<string, unknown>`)
 * e sai daqui tipado como o payload concreto do evento.
 *
 * O `as unknown as` é deliberado e é o mais honesto que dá para escrever sem
 * mudar comportamento. Quem garante a forma é o publicador (o trigger que grava
 * em `domain_events`), mais o `getHandler(row.event_type)` do chamador, que já
 * recusa event_type sem handler registrado. O compilador não enxerga nenhuma das
 * duas coisas, e um `as` simples é recusado porque os dois tipos não se
 * sobrepõem — validar o payload aqui seria mudar o caminho de erro de um módulo
 * compartilhado, decisão que não cabe a uma limpeza de tipos.
 */
function rowToEvent(row: DomainEventRow): DomainEvent {
  return {
    event_type: row.event_type as DomainEvent["event_type"],
    aggregate_type: row.aggregate_type as DomainEvent["aggregate_type"],
    aggregate_id: row.aggregate_id,
    organization_id: row.organization_id,
    payload: row.payload,
    metadata: row.metadata,
  } as unknown as DomainEvent;
}
