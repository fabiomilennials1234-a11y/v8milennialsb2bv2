/**
 * input-short-circuit — Copilot v2 guardrail (Slice 5, ADR-0002 #7).
 *
 * Deterministic pre-cognition classifier: spam/abuse/competitor probes are
 * handled WITHOUT spending an LLM turn. Pure (no I/O). fail-OPEN by design — an
 * ambiguous message returns 'pass' so normal cognition decides; we never silence
 * a legitimate lead. 'canned' ships a fixed reply (no LLM); 'drop' acks without
 * enqueue. Competitor/abuse phrasing is configurable; this is the safe baseline.
 */

export type ShortCircuitAction = "pass" | "canned" | "drop";
export type ShortCircuitCategory = "spam" | "abuse" | "competitor" | null;

export interface ShortCircuitResult {
  action: ShortCircuitAction;
  category: ShortCircuitCategory;
  cannedReply?: string;
}

const ABUSE = /\b(idiota|lixo|imbecil|otári[oa]|vai se ferrar|vai se f\w+|merda|cuz[ãa]o)\b/i;
const COMPETITOR = /(sou d[oa].*(concorrente|outra empresa)|comparar.*(pre[çc]o|tabela)|cota[çc][ãa]o.*comparar)/i;
const URL = /https?:\/\/\S+/gi;

const CANNED_ABUSE = "Estou aqui pra ajudar com respeito. Se puder reformular sua mensagem, sigo com você.";
const CANNED_COMPETITOR = "Posso falar sobre nossas soluções e condições. Como posso te ajudar hoje?";

export function classifyInbound(text: string): ShortCircuitResult {
  const t = (text ?? "").trim();
  if (t.length < 3) return { action: "pass", category: null }; // fail-OPEN: too short to judge

  const urlCount = (t.match(URL) ?? []).length;
  const shouty = t === t.toUpperCase() && t.length > 12;
  if (urlCount >= 3 || (urlCount >= 2 && shouty)) {
    return { action: "drop", category: "spam" };
  }
  if (ABUSE.test(t)) {
    return { action: "canned", category: "abuse", cannedReply: CANNED_ABUSE };
  }
  if (COMPETITOR.test(t)) {
    return { action: "canned", category: "competitor", cannedReply: CANNED_COMPETITOR };
  }
  return { action: "pass", category: null };
}
