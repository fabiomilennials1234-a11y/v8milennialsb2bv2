/**
 * broadcastTransport — tradução Broadcast privado ⇄ contrato `postgres_changes`.
 *
 * Perf S1 (2026-10-19, `.specs/perf/realtime-broadcast/S1.md`): o poll do WAL
 * do `postgres_changes` é 16,2% do banco. Uma tabela daqui é publicada por
 * trigger (`private.rt_broadcast_*`, migration 20271128000000) num tópico
 * PRIVADO por org; a autorização roda no join do canal, não por evento.
 *
 * Os consumidores não mudam: o registry converte o envelope do trigger no
 * mesmo `RealtimePostgresChangesPayload` que recebiam, e aplica no cliente o
 * filtro `coluna=eq.valor` que antes ia ao servidor. O tópico já é da org
 * inteira e autorizado no join — o filtro é recorte de tela, não segurança.
 *
 * Contrato com o SQL: `columns` = allowlist de `private.rt_pipeline_entry_row`
 * (o teste de integração `realtime-broadcast-s1` confere os dois). Filtro numa
 * coluna fora dela não dá para aplicar no cliente → a assinatura fica no
 * `postgres_changes`.
 */
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";

type Row = Record<string, unknown>;

interface BroadcastTable {
  /** Sufixo do tópico: `org:{org}:{suffix}`. */
  suffix: string;
  /** Chave da tabela no plano (`realtime_subscription_plan`). */
  planKey: string;
  /** Colunas do payload (allowlist do trigger). */
  columns: readonly string[];
}

export const BROADCAST_TABLES: Readonly<Record<string, BroadcastTable>> = {
  pipeline_entries: {
    suffix: "pe",
    planKey: "pipeline_entries",
    columns: [
      "id",
      "organization_id",
      "pipeline_id",
      "lead_id",
      "deal_id",
      "stage_id",
      "stage_key",
      "assigned_to",
      "entered_at",
      "stage_changed_at",
      "closed_at",
      "created_at",
      "updated_at",
    ],
  },
};

export function broadcastTopic(table: string, organizationId: string): string | null {
  const t = BROADCAST_TABLES[table];
  return t ? `org:${organizationId}:${t.suffix}` : null;
}

export interface EqFilter {
  column: string;
  value: string;
}

/** `coluna=eq.valor` (o único formato que os chamadores usam). Outro formato → null. */
export function parseEqFilter(filter: string): EqFilter | null {
  const m = /^([a-z_][a-z0-9_]*)=eq\.(.+)$/.exec(filter);
  return m ? { column: m[1], value: m[2] } : null;
}

/**
 * Esta assinatura pode ir para o broadcast? Tabela conhecida e filtro que o
 * cliente consegue reproduzir (ausente, ou `eq` numa coluna do payload).
 */
export function broadcastSupports(table: string, filter: string | undefined): boolean {
  const t = BROADCAST_TABLES[table];
  if (!t) return false;
  if (filter === undefined) return true;
  const eq = parseEqFilter(filter);
  return eq !== null && t.columns.includes(eq.column);
}

/** Envelope v1 publicado pelo trigger. */
export interface BroadcastEnvelope {
  v: 1;
  t: string;
  op: "INSERT" | "UPDATE" | "DELETE";
  id: string;
  row: Row | null;
  old: Row | null;
  ts?: string;
}

function isEnvelope(x: unknown): x is BroadcastEnvelope {
  if (!x || typeof x !== "object") return false;
  const e = x as Partial<BroadcastEnvelope>;
  return e.v === 1 && typeof e.t === "string" && (e.op === "INSERT" || e.op === "UPDATE" || e.op === "DELETE");
}

/**
 * Envelope → payload no formato do `postgres_changes`. Diferenças conhecidas,
 * a favor do consumidor: `old` traz a allowlist (o `postgres_changes` com RLS
 * trazia só a PK) e `new` traz só a allowlist (sem `notes`/`metadata`).
 * Envelope de outra versão/tabela → null (ignorado).
 */
export function envelopeToPayload(
  table: string,
  envelope: unknown,
): RealtimePostgresChangesPayload<Row> | null {
  if (!isEnvelope(envelope) || envelope.t !== table) return null;
  const base = {
    schema: "public",
    table,
    commit_timestamp: envelope.ts ?? new Date().toISOString(),
    errors: [] as string[],
  };
  const row = envelope.row ?? {};
  const old = envelope.old ?? {};
  switch (envelope.op) {
    case "INSERT":
      return { ...base, eventType: "INSERT", new: row, old: {} };
    case "UPDATE":
      return { ...base, eventType: "UPDATE", new: row, old };
    case "DELETE":
      return { ...base, eventType: "DELETE", new: {}, old };
  }
}

/**
 * O evento passa no filtro `eq`? Mesma regra do servidor: INSERT/UPDATE
 * olham a linha nova, DELETE a antiga.
 */
export function payloadMatches(payload: RealtimePostgresChangesPayload<Row>, filter: EqFilter | null): boolean {
  if (!filter) return true;
  const row = (payload.eventType === "DELETE" ? payload.old : payload.new) as Row;
  const v = row?.[filter.column];
  return v !== null && v !== undefined && String(v) === filter.value;
}
