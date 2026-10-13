/**
 * Handoff do MESMO turno × gate de cancelamento da mídia.
 *
 * Problema: num turno [send_document, transfer_to_human] a transferência roda
 * INLINE (RPC `transfer_lead_to_human` → `leads.ai_disabled` → trigger
 * `sync_lead_ai_to_preferences` → `phone_ai_preferences`) e a mídia vai para a
 * fila. Quando o worker pega o SEND_DOCUMENT, `isCopilotCanceled` vê a IA
 * desligada — pelo PRÓPRIO turno — e descarta o documento em silêncio.
 *
 * Solução: prova de identidade do desligamento. O engine, ao transferir,
 * registra o carimbo do desligamento que ELE causou (`disabled_at`, lido
 * depois do RPC) — e só quando a IA estava LIGADA antes do RPC. O worker
 * entrega a mídia apenas se o desligamento vigente é exatamente aquele.
 *
 * Não vira bypass genérico:
 *  - IA já desligada antes do turno (humano, pausa, bulk) → engine não emite
 *    marcador → worker cancela como sempre.
 *  - Humano desliga/religa/desliga DEPOIS do turno → carimbo muda → cancela.
 *  - Pausa humana ativa (`human_paused_until` no futuro) → cancela sempre.
 *  - Fonte `error`/`default`/`human_pause` → nunca libera.
 *  - Marcador de outro lead → nunca libera.
 *  - O engine remove qualquer `same_turn_handoff` vindo dos params do LLM; só
 *    o próprio engine o escreve (ver agent-engine.ts#executeAction).
 *
 * Puro: sem I/O. Testado em same-turn-handoff.test.ts.
 */

import type { CancellationCheck } from "./cancellation.ts";

/** Chave do payload da ação de mídia que carrega o marcador. */
export const SAME_TURN_HANDOFF_KEY = "same_turn_handoff";

export interface SameTurnHandoffMarker {
  lead_id: string;
  /** Carimbo do desligamento causado pelo handoff do turno (timestamptz). */
  disabled_at: string;
}

const RELEASABLE_SOURCES = new Set<CancellationCheck["source"]>(["phone_ai_preferences", "leads"]);

function sameInstant(a: string, b: string): boolean {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  return Number.isFinite(ta) && Number.isFinite(tb) && ta === tb;
}

/**
 * Marcador do handoff do turno. `before` = gate ANTES do RPC; `after` = gate
 * DEPOIS. Só existe quando a IA estava ligada antes (o desligamento é deste
 * turno) e o gate posterior carrega um carimbo legível.
 */
export function buildSameTurnHandoffMarker(
  leadId: string,
  before: CancellationCheck,
  after: CancellationCheck,
): SameTurnHandoffMarker | null {
  if (!leadId) return null;
  if (before.canceled || before.source === "error") return null;
  if (!after.canceled || !RELEASABLE_SOURCES.has(after.source)) return null;
  if (after.humanPauseActive) return null;
  if (typeof after.disabledAt !== "string" || !Number.isFinite(Date.parse(after.disabledAt))) return null;
  return { lead_id: leadId, disabled_at: after.disabledAt };
}

/** Parse defensivo do marcador vindo do payload da fila. */
export function parseSameTurnHandoffMarker(raw: unknown): SameTurnHandoffMarker | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.lead_id !== "string" || r.lead_id.length === 0) return null;
  if (typeof r.disabled_at !== "string" || !Number.isFinite(Date.parse(r.disabled_at))) return null;
  return { lead_id: r.lead_id, disabled_at: r.disabled_at };
}

/**
 * true ⇔ o cancelamento vigente é EXATAMENTE o handoff do turno que enfileirou
 * a mídia — e portanto a mídia daquele turno deve sair.
 */
export function isSameTurnHandoffCancel(
  check: CancellationCheck,
  rawMarker: unknown,
  leadId: string | null,
): boolean {
  if (!check.canceled || !check.ai_disabled) return false;
  if (!RELEASABLE_SOURCES.has(check.source)) return false;
  if (check.humanPauseActive) return false;
  const marker = parseSameTurnHandoffMarker(rawMarker);
  if (!marker || !leadId || marker.lead_id !== leadId) return false;
  if (typeof check.disabledAt !== "string") return false;
  return sameInstant(check.disabledAt, marker.disabled_at);
}
