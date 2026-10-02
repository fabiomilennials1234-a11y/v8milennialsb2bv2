/**
 * Diagnóstico de Chamado — o domínio puro do painel do Suporte (master).
 *
 * Processo em 4 etapas (docs/operations/chamado-fix.md): o cliente abre o
 * Chamado → o dev roda `/chamado-diagnosticar <id>` no Claude Code → o Claude
 * grava aqui o diagnóstico e o prompt de resolução → o dev operacional responde
 * o cliente e executa o prompt.
 *
 * Os domínios espelham os CHECKs de `support_ticket_diagnoses` e a validação do
 * torque-mcp (`support.record_diagnosis`). Mudou um, muda os três.
 */

export const DIAGNOSIS_KINDS = ["fix", "feature", "configuracao", "duvida"] as const;
export const DIAGNOSIS_COMPLEXITIES = ["trivial", "baixa", "media", "alta", "critica"] as const;
export const CLAUDE_MODELS = ["haiku", "sonnet", "opus", "fable"] as const;
export const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export const EXECUTION_OUTCOMES = ["resolvido", "parcial", "falhou"] as const;
/** A execução confirmou a causa diagnosticada? Mede a precisão do diagnóstico. */
export const CAUSE_CONFIRMATIONS = ["sim", "nao", "parcial"] as const;

export type DiagnosisKind = (typeof DIAGNOSIS_KINDS)[number];
export type DiagnosisComplexity = (typeof DIAGNOSIS_COMPLEXITIES)[number];
export type ClaudeModel = (typeof CLAUDE_MODELS)[number];
export type ClaudeEffort = (typeof CLAUDE_EFFORTS)[number];
export type ExecutionOutcome = (typeof EXECUTION_OUTCOMES)[number];
export type CauseConfirmation = (typeof CAUSE_CONFIRMATIONS)[number];

export interface Keystone {
  label: string;
  verify: string;
}

export interface Route {
  model: ClaudeModel;
  effort: ClaudeEffort;
}

export const KIND_LABELS: Record<DiagnosisKind, string> = {
  fix: "Fix",
  feature: "Feature",
  configuracao: "Configuração",
  duvida: "Dúvida",
};

export const COMPLEXITY_LABELS: Record<DiagnosisComplexity, string> = {
  trivial: "Trivial",
  baixa: "Baixa",
  media: "Média",
  alta: "Alta",
  critica: "Crítica",
};

export const OUTCOME_LABELS: Record<ExecutionOutcome, string> = {
  resolvido: "Resolvido",
  parcial: "Parcial",
  falhou: "Falhou",
};

export const CAUSE_LABELS: Record<CauseConfirmation, string> = {
  sim: "Causa confirmada",
  parcial: "Causa parcial",
  nao: "Causa errada",
};

export const MODEL_LABELS: Record<ClaudeModel, string> = {
  haiku: "Haiku",
  sonnet: "Sonnet",
  opus: "Opus",
  fable: "Fable",
};

/**
 * Matriz de roteamento: complexidade → modelo e effort da sessão de execução.
 *
 * Racional (arXiv 2609.20804, "An Empirical Study of Harness Design"): o modelo
 * forte não precisa de andaime — planejamento nele corta custo, não sobe
 * acurácia; o modelo mais fraco precisa de plano explícito e ferramentas
 * estruturadas para não abandonar a task. O prompt de resolução sempre leva
 * plano + keystones, então o roteamento escolhe pelo risco do erro, não pelo
 * tamanho do diff:
 *
 * - Código: nunca Haiku — um fix errado em produção custa mais que o token
 *   economizado. `trivial`/`baixa` cabem no Sonnet; `media`+ é Opus.
 * - Sem código (`duvida`, `configuracao`): o trabalho é ler e redigir — Haiku
 *   até `baixa`, Sonnet acima.
 * - `fable` fica fora da matriz: só por escolha explícita de quem diagnostica.
 */
const CODE_ROUTES: Record<DiagnosisComplexity, Route> = {
  trivial: { model: "sonnet", effort: "low" },
  baixa: { model: "sonnet", effort: "medium" },
  media: { model: "opus", effort: "medium" },
  alta: { model: "opus", effort: "high" },
  critica: { model: "opus", effort: "xhigh" },
};

const NO_CODE_ROUTES: Record<DiagnosisComplexity, Route> = {
  trivial: { model: "haiku", effort: "low" },
  baixa: { model: "haiku", effort: "medium" },
  media: { model: "sonnet", effort: "medium" },
  alta: { model: "sonnet", effort: "high" },
  critica: { model: "sonnet", effort: "high" },
};

export function routeFor(kind: DiagnosisKind, complexity: DiagnosisComplexity): Route {
  const table = kind === "fix" || kind === "feature" ? CODE_ROUTES : NO_CODE_ROUTES;
  return table[complexity];
}

const MODEL_RANK: Record<ClaudeModel, number> = { haiku: 0, sonnet: 1, opus: 2, fable: 3 };
const EFFORT_RANK: Record<ClaudeEffort, number> = { low: 0, medium: 1, high: 2, xhigh: 3, max: 4 };

/**
 * Onde a rota gravada fica em relação à matriz. `acima` custa mais do que a
 * complexidade pede; `abaixo` arrisca a acurácia. Nenhum dos dois é erro — é
 * um sinal para quem lê o diagnóstico conferir o porquê.
 */
export function routeDeviation(
  kind: DiagnosisKind,
  complexity: DiagnosisComplexity,
  chosen: Route,
): "na-matriz" | "acima" | "abaixo" {
  const expected = routeFor(kind, complexity);
  const delta =
    (MODEL_RANK[chosen.model] - MODEL_RANK[expected.model]) * 10 +
    (EFFORT_RANK[chosen.effort] - EFFORT_RANK[expected.effort]);
  if (delta === 0) return "na-matriz";
  return delta > 0 ? "acima" : "abaixo";
}

/**
 * O que o dev cola no Claude Code antes do prompt, UM comando por colagem: o
 * Claude Code lê a colagem inteira como um comando só, então `/model opus` e
 * `/effort medium` juntos viram "Model 'opus\n/effort medium' not found".
 */
export function sessionCommands(route: Route): { model: string; effort: string } {
  return { model: `/model ${route.model}`, effort: `/effort ${route.effort}` };
}

/**
 * Quantas mensagens do cliente chegaram depois do diagnóstico. Maior que zero,
 * a resposta sugerida pode ter ficado velha: no Chamado 39ff2cd1 o cliente
 * desmentiu a resposta 7 minutos depois de ela ser enviada.
 */
export function customerRepliesSince(
  comments: ReadonlyArray<{ from_staff: boolean; is_internal: boolean; created_at: string }>,
  since: string,
): number {
  const t = Date.parse(since);
  return comments.filter(
    (c) => !c.from_staff && !c.is_internal && Date.parse(c.created_at) > t,
  ).length;
}

/** O comando que inicia a etapa 2 para este Chamado. */
export function diagnoseCommand(ticketId: string): string {
  return `/chamado-diagnosticar ${ticketId}`;
}

/** Lê `keystones` (jsonb) sem confiar no formato: descarta o que não é keystone. */
export function parseKeystones(raw: unknown): Keystone[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((k) => {
    if (typeof k !== "object" || k === null) return [];
    const o = k as Record<string, unknown>;
    const label = typeof o.label === "string" ? o.label.trim() : "";
    const verify = typeof o.verify === "string" ? o.verify.trim() : "";
    return label ? [{ label, verify }] : [];
  });
}

export function isOneOf<T extends readonly string[]>(list: T, v: unknown): v is T[number] {
  return typeof v === "string" && (list as readonly string[]).includes(v);
}

export interface DiagnosisDraft {
  kind: DiagnosisKind;
  complexity: DiagnosisComplexity;
  summary: string;
  root_cause: string;
  customer_reply: string;
  recommended_model: ClaudeModel;
  recommended_effort: ClaudeEffort;
  resolution_prompt: string;
  keystones: Keystone[];
  estimated_cost_usd: string;
}

/**
 * Validação do formulário manual — as mesmas regras do banco, com mensagem em
 * português antes do 23514. Devolve todos os problemas de uma vez.
 */
export function validateDraft(d: DiagnosisDraft): string[] {
  const errors: string[] = [];
  const summary = d.summary.trim();
  if (summary.length < 10 || summary.length > 2000) {
    errors.push("O diagnóstico precisa de 10 a 2.000 caracteres.");
  }
  if (d.kind === "fix" && !d.root_cause.trim()) {
    errors.push("Fix sem root cause é palpite — descreva a causa.");
  }
  if (d.root_cause.length > 4000) errors.push("A root cause passa de 4.000 caracteres.");
  if (d.customer_reply.length > 4000) errors.push("A resposta ao cliente passa de 4.000 caracteres.");
  const prompt = d.resolution_prompt.trim();
  if (prompt.length < 50 || prompt.length > 60000) {
    errors.push("O prompt precisa de 50 a 60.000 caracteres.");
  }
  const keystones = d.keystones.filter((k) => k.label.trim() || k.verify.trim());
  if (keystones.length < 1 || keystones.length > 15) {
    errors.push("Defina de 1 a 15 keystones — é o critério de pronto da task.");
  }
  if (keystones.some((k) => !k.label.trim() || !k.verify.trim())) {
    errors.push("Cada keystone precisa do que prova e de como verificar.");
  }
  if (d.estimated_cost_usd.trim()) {
    const n = Number(d.estimated_cost_usd.replace(",", "."));
    if (!Number.isFinite(n) || n < 0) errors.push("Custo estimado inválido.");
  }
  return errors;
}

/** Parse de um valor em US$ digitado (aceita vírgula). `null` quando vazio. */
export function parseUsd(raw: string): number | null {
  const t = raw.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

export function formatUsd(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `US$ ${Number(n).toFixed(2)}`;
}
