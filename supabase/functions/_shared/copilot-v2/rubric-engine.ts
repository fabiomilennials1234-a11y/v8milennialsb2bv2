/**
 * rubric-engine — Copilot v2 hybrid qualification (Slice 4).
 *
 * ADR-0002 #3. The LLM extracts B2B signals; THIS deterministic engine maps them
 * to a qualification_tier via the org's rubric. The LLM never judges the tier.
 *
 * Carteira uses its OWN segment scale (ouro/prata/novo/resgate/dormindo) and
 * must NOT be routed through this engine — different scale, never conflated.
 */

export type QualificationTier =
  | "diamante"
  | "ouro"
  | "prata"
  | "bronze"
  | "desqualificado";

export type Level = "alta" | "media" | "baixa";

export interface Signals {
  faturamentoMensal?: number | null;
  volumeMensal?: number | null;
  recorrencia?: Level | null;
  urgencia?: Level | null;
  icpFit?: boolean | null;
  regiao?: string | null;
}

export interface TierRule {
  tier: Exclude<QualificationTier, "desqualificado">;
  minFaturamento?: number;
  minVolume?: number;
  minRecorrencia?: Level;
  minUrgencia?: Level;
  requiresIcp?: boolean;
}

export interface Rubric {
  rules: TierRule[];
}

const TIER_RANK: Record<QualificationTier, number> = {
  diamante: 4,
  ouro: 3,
  prata: 2,
  bronze: 1,
  desqualificado: 0,
};

const LEVEL_RANK: Record<Level, number> = { alta: 3, media: 2, baixa: 1 };

function ruleSatisfied(rule: TierRule, s: Signals): boolean {
  if (rule.minFaturamento != null) {
    if (s.faturamentoMensal == null || s.faturamentoMensal < rule.minFaturamento) return false;
  }
  if (rule.minVolume != null) {
    if (s.volumeMensal == null || s.volumeMensal < rule.minVolume) return false;
  }
  if (rule.minRecorrencia != null) {
    if (s.recorrencia == null || LEVEL_RANK[s.recorrencia] < LEVEL_RANK[rule.minRecorrencia]) return false;
  }
  if (rule.minUrgencia != null) {
    if (s.urgencia == null || LEVEL_RANK[s.urgencia] < LEVEL_RANK[rule.minUrgencia]) return false;
  }
  if (rule.requiresIcp === true && s.icpFit !== true) return false;
  return true;
}

/**
 * Deterministic: returns the highest-ranked tier whose rule is fully satisfied,
 * else 'desqualificado'. Pure — same (signals, rubric) always yields the same
 * tier.
 */
export function mapSignalsToTier(signals: Signals, rubric: Rubric): QualificationTier {
  const satisfied = rubric.rules
    .filter((rule) => ruleSatisfied(rule, signals))
    .sort((a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier]);

  return satisfied.length > 0 ? satisfied[0].tier : "desqualificado";
}
