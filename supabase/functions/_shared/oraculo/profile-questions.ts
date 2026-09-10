/** Perguntas curtas que ligam o perfil declarado a uma medição real do turno. */

export const PROFILE_QUESTION_KEYS = [
  "sales_outside_crm",
  "meeting_definition",
  "seasonality",
  "perceived_bottleneck",
  "personal_practice",
] as const;

export type ProfileQuestionKey = typeof PROFILE_QUESTION_KEYS[number];

export interface ProfileQuestion {
  id: string;
  question_key: ProfileQuestionKey;
  prompt: string;
  measured_context: Record<string, unknown>;
}

interface Evidence {
  name: string;
  result: unknown;
}

interface BuildProfileQuestionsArgs {
  evidence: Evidence[];
  askedKeys: string[];
  room: number;
  id?: () => string;
}

interface Candidate {
  question_key: ProfileQuestionKey;
  prompt: string;
  measured_context: Record<string, unknown>;
}

export function buildProfileQuestions(args: BuildProfileQuestionsArgs): ProfileQuestion[] {
  const room = Math.max(0, Math.min(3, Math.floor(args.room)));
  if (room === 0) return [];

  const asked = new Set(args.askedKeys);
  const candidates = [
    ...metricCandidates(findEvidence(args.evidence, "metricas")),
    ...funnelCandidates(findEvidence(args.evidence, "funil")),
  ];
  const nextId = args.id ?? (() => crypto.randomUUID());

  return candidates
    .filter((candidate, index, all) =>
      !asked.has(candidate.question_key) &&
      all.findIndex((other) => other.question_key === candidate.question_key) === index
    )
    .slice(0, room)
    .map((candidate) => ({ id: nextId(), ...candidate }));
}

function findEvidence(evidence: Evidence[], name: string): Record<string, unknown> | null {
  const result = evidence.find((item) => item.name === name)?.result;
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const row = result as Record<string, unknown>;
  return row.error ? null : row;
}

function metricCandidates(row: Record<string, unknown> | null): Candidate[] {
  if (!row) return [];
  const days = integer(row.periodo_dias);
  const sales = integer(row.vendas);
  const revenue = number(row.receita);
  const ticket = number(row.ticket_medio);
  const leads = integer(row.leads_criados);
  const conversion = number(row.conversao_lead_venda);
  const meetings = integer(row.reunioes_marcadas);
  if (days === null) return [];

  const measured = { source: "metricas", ...row };
  const candidates: Candidate[] = [];

  if (sales !== null && revenue !== null && ticket !== null) {
    candidates.push({
      question_key: "sales_outside_crm",
      prompt: `Nos últimos ${days} dias, medi ${sales} vendas no CRM, ${
        brl(revenue)
      } de receita e ticket médio de ${
        brl(ticket)
      }. Isso representa todas as vendas ou existe venda fechada fora do CRM?`,
      measured_context: measured,
    });
  }
  if (meetings !== null) {
    candidates.push({
      question_key: "meeting_definition",
      prompt:
        `Nos últimos ${days} dias, medi ${meetings} reuniões marcadas. O que a sua operação considera uma reunião válida para esse número?`,
      measured_context: measured,
    });
  }
  if (leads !== null && sales !== null && conversion !== null) {
    candidates.push({
      question_key: "seasonality",
      prompt: `Nos últimos ${days} dias, medi ${leads} leads, ${sales} vendas e ${
        percent(conversion)
      } de conversão. Esse período representa uma rotina normal ou houve sazonalidade que muda a leitura?`,
      measured_context: measured,
    });
  }
  if (row.escopo === "pessoa" && leads !== null && sales !== null) {
    candidates.push({
      question_key: "personal_practice",
      prompt:
        `No seu recorte dos últimos ${days} dias, medi ${leads} leads e ${sales} vendas. Que prática sua costuma mudar esse resultado e ainda não aparece no CRM?`,
      measured_context: measured,
    });
  }
  return candidates;
}

function funnelCandidates(row: Record<string, unknown> | null): Candidate[] {
  if (!row || !Array.isArray(row.etapas)) return [];
  const total = integer(row.total_aberto);
  const days = integer(row.periodo_dias);
  const stages = row.etapas
    .filter((stage): stage is Record<string, unknown> =>
      Boolean(stage) && typeof stage === "object"
    )
    .map((stage) => ({ stage, count: integer(stage.negocios) }))
    .filter((item): item is { stage: Record<string, unknown>; count: number } =>
      item.count !== null
    )
    .sort((a, b) => b.count - a.count);
  const top = stages[0];
  const name = top && (text(top.stage.etapa) || text(top.stage.chave));
  if (total === null || total <= 0 || days === null || !top || !name) return [];

  return [{
    question_key: "perceived_bottleneck",
    prompt:
      `Nos últimos ${days} dias, encontrei ${top.count} de ${total} negócios abertos concentrados em ${name}. Você percebe essa etapa como o principal gargalo? O que acontece ali na prática?`,
    measured_context: { source: "funil", ...row, measured_stage: top.stage },
  }];
}

function integer(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
}

function number(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function brl(value: number): string {
  return `R$ ${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value)}`;
}

function percent(value: number): string {
  return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value * 100)}%`;
}
