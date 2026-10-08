/**
 * stage-role-classifier — twin frontend do core determinístico (#991).
 *
 * O canônico vive no runtime Deno:
 *   supabase/functions/_shared/metrics/stage-role-classifier.ts
 *
 * Arquivos de edge function usam import specifiers `.ts` estilo Deno e vivem
 * fora do grafo tsconfig/ESLint `boundaries` do frontend, então não entram no
 * bundle Vite. Este módulo é o gêmeo byte-a-byte da parte determinística —
 * mesmo algoritmo, zero divergência — para o modal de etapa sugerir o
 * stage_role instantaneamente enquanto o usuário digita o nome, sem round
 * trip. Segue o precedente twin documentado (permissions engine em
 * `identity/permissions/lib/permissions.ts`, blast-planning em
 * `campaigns/lib/blast-planning.ts`).
 *
 * INVARIANTE: manter em lockstep com o fonte Deno. Paridade pinada por
 * `tests/unit/stage-role-classifier-twin.test.ts` (mesmo corpus, head-to-head).
 * Sem IO, sem clock — funções puras.
 */

import type { StageRole, SuggestableStageRole, StageRoleSuggestionSource } from "@/contracts/pipe";

export type { StageRole, SuggestableStageRole, StageRoleSuggestionSource };

export interface StageRoleSuggestion {
  role: SuggestableStageRole;
  source: StageRoleSuggestionSource;
}

/**
 * Normaliza nome de etapa para matching: minúsculas, sem acentos, sem
 * emoji/pontuação, espaços colapsados. "Reunião Marcada ✓" → "reuniao marcada".
 */
export function normalizeStageName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

interface Rule {
  role: SuggestableStageRole;
  pattern: RegExp;
}

// Mapa determinístico de sinônimos pt-BR — cópia exata do canônico Deno.
// Ordem importa: negações de comparecimento primeiro; won antes de
// meeting_held ("venda realizada"); lost antes dos meeting_*.
const RULES: readonly Rule[] = [
  // ── won — fechado/ganhou/vendido/comprou/recomprou ─────────────────────
  { role: "won", pattern: /\b(fechado|fechada|fechou)\b/ },
  { role: "won", pattern: /\b(ganho|ganha|ganhou|ganhamos)\b/ },
  { role: "won", pattern: /\b(vendido|vendida|vendeu)\b/ },
  { role: "won", pattern: /\bvenda\s+(fechada|realizada|concluida|ganha)\b/ },
  { role: "won", pattern: /\b(comprou|recomprou|recompra)\b/ },
  { role: "won", pattern: /\bcontrato\s+(assinado|fechado)\b/ },

  // ── lost — perdido/desistiu/sem interesse ──────────────────────────────
  { role: "lost", pattern: /\b(perdido|perdida|perdeu|perdemos|perda)\b/ },
  { role: "lost", pattern: /\b(desistiu|desistencia|desqualificado|desqualificada)\b/ },
  { role: "lost", pattern: /\b(sem|nao\s+tem)\s+interesse\b/ },
  { role: "lost", pattern: /\b(recusou|recusado|recusada|declinou|churn)\b/ },

  // ── meeting_held — compareceu/realizada ────────────────────────────────
  { role: "meeting_held", pattern: /\b(compareceu|comparecimento)\b/ },
  {
    role: "meeting_held",
    pattern: /\b(reuniao|call|visita|demo|apresentacao)\s+(realizada|feita|concluida|aconteceu)\b/,
  },
  { role: "meeting_held", pattern: /\b(realizada|realizado)\b/ },

  // ── meeting_booked — reunião marcada/agendada ──────────────────────────
  { role: "meeting_booked", pattern: /\b(agendado|agendada|agendamento)\b/ },
  {
    role: "meeting_booked",
    pattern: /\b(reuniao|call|visita|demo|apresentacao)\s+(marcada|agendada|confirmada)\b/,
  },
  { role: "meeting_booked", pattern: /\bmarcou\s+(reuniao|call|visita|demo)\b/ },
] as const;

/**
 * Nomes que VETAM qualquer sugestão — o classificador devolve `null` e a etapa
 * fica com o `open` que já é o padrão.
 *
 * Estes dois padrões existiam como `{ role: "lost" }` e essa era a redação
 * errada de uma intenção certa. A intenção: "não compareceu" contém
 * "compareceu", então precisa ser decidido ANTES da regra de `meeting_held`,
 * senão vira reunião realizada. O erro: resolver isso chamando a falta de
 * PERDA.
 *
 * Falta não é perda. O enum diz:
 *   open = "não gera métrica de reunião nem de venda"
 *   lost = "encerra a oportunidade sem venda — conta como perda"
 * Quem faltou não encerrou nada — segue vivo e precisa de nova data. Medido em
 * prod: 140 leads da Milennials contavam como perdidos por terem faltado.
 *
 * 🚨 O veto corta o classificador INTEIRO, não só a etapa do nome. As duas
 * linhas erradas em prod tinham `is_final_negative = true` junto, e o fallback
 * de flag em `classifyStageRole` devolve `lost` por conta própria — vetar só o
 * nome deixaria a flag reconduzir ao mesmo destino.
 *
 * `SuggestableStageRole` é `Exclude<StageRole, "open">`: sugerir `open` é
 * impossível por tipo, e é por isso que isto é um veto e não mais uma regra.
 */
const VETOS: readonly RegExp[] = [
  /\b(nao|sem)\s+(compareceu|comparecimento)\b/,
  /\bno\s?show\b/,
];

/** O nome é uma falta — nenhuma sugestão vale, nem a vinda de flag. */
export function nomeVetaSugestao(name: string): boolean {
  const normalized = normalizeStageName(name);
  if (!normalized) return false;
  return VETOS.some((v) => v.test(normalized));
}

/**
 * Classificação determinística pelo NOME. `null` = nome não-óbvio.
 */
export function classifyStageNameDeterministic(
  name: string,
): SuggestableStageRole | null {
  const normalized = normalizeStageName(name);
  if (!normalized) return null;
  if (nomeVetaSugestao(name)) return null;
  for (const rule of RULES) {
    if (rule.pattern.test(normalized)) return rule.role;
  }
  return null;
}

export interface StageClassifierInput {
  name: string;
  isFinalPositive?: boolean;
  isFinalNegative?: boolean;
}

/**
 * Classificador completo: nome (determinístico) → flags de board (sinal
 * fraco, fallback). Nome sempre vence a flag. `null` = sem sugestão.
 */
export function classifyStageRole(
  input: StageClassifierInput,
): StageRoleSuggestion | null {
  // Antes de tudo: falta não vira sugestão nenhuma — nem pelo nome, nem pela
  // flag de board logo abaixo. Ver `VETOS`.
  if (nomeVetaSugestao(input.name)) return null;
  const byName = classifyStageNameDeterministic(input.name);
  if (byName) return { role: byName, source: "deterministic" };
  if (input.isFinalPositive) return { role: "won", source: "flag" };
  if (input.isFinalNegative) return { role: "lost", source: "flag" };
  return null;
}

export type StageRoleAction = "auto_apply" | "queue_review";

/**
 * Semântica de aplicação (ADR-0017 §1): meeting_* auto-aplica; won/lost =
 * dinheiro = confirmação humana obrigatória. SEMPRE.
 */
export function decideStageRoleAction(role: SuggestableStageRole): StageRoleAction {
  return role === "won" || role === "lost" ? "queue_review" : "auto_apply";
}
