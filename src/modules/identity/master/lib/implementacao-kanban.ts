/**
 * Implementação — o kanban de implantação dos clientes (regras IM-1…IM-7).
 *
 * Espelho, para a TELA, dos gates que `master_advance_implementation` cobra no
 * banco (migration 20271105000100). Os fatos chegam prontos em `gates` — a tela
 * não recalcula WhatsApp, funis ou venda; só decide o que oferecer e explica o
 * que falta. Mudou um gate lá, muda aqui (os testes descrevem os dois).
 */

export const IMPLEMENTACAO_STAGES = ["cliente_novo", "construcao", "call", "concluido"] as const;
export type ImplementacaoStage = (typeof IMPLEMENTACAO_STAGES)[number];

export const IMPLEMENTACAO_STAGE_LABELS: Record<ImplementacaoStage, string> = {
  cliente_novo: "Cliente novo",
  construcao: "Construção de Org",
  call: "Call de Apresentação",
  concluido: "Concluído",
};

export const IMPLEMENTACAO_STAGE_HINTS: Record<ImplementacaoStage, string> = {
  cliente_novo: "Contrato fechado, org criada",
  construcao: "Funis, WhatsApp e copilot",
  call: "Apresentação ao cliente",
  concluido: "1ª venda registrada",
};

/** IM-5. */
export const STALE_STAGE_DAYS = 7;

/** IM-6: os 6 passos fixos do checklist do cliente, na ordem dele. */
export const CHECKLIST_STEPS = [
  ["whatsapp", "WhatsApp conectado"],
  ["lead", "Primeiro lead"],
  ["copilot", "Copilot criado"],
  ["automacao", "Automação criada"],
  ["membro", "Membro convidado"],
  ["venda", "Primeira venda"],
] as const;
export type ChecklistStep = (typeof CHECKLIST_STEPS)[number][0];

export interface ImplementacaoGates {
  has_plan: boolean;
  whatsapp_connected: boolean;
  pipelines_total: number;
  pipelines_won_lost: number;
  first_sale: boolean;
  /** `null` quando a org não tem linha em `org_onboarding_progress`. */
  checklist: Record<ChecklistStep, boolean> | null;
}

export interface ImplementacaoFacts {
  stage: ImplementacaoStage;
  owner_master_user_id: string | null;
  stage_entered_at: string;
  gates: ImplementacaoGates;
}

/** Um requisito da próxima passagem, com o estado dele — a lista que a tela mostra. */
export interface Requirement {
  label: string;
  done: boolean;
}

/** IM-2/3/4: o que a passagem PARA `to` exige. */
export function requirementsFor(item: ImplementacaoFacts, to: ImplementacaoStage): Requirement[] {
  const g = item.gates;
  switch (to) {
    case "cliente_novo":
      return [];
    case "construcao":
      return [
        { label: "Plano definido", done: g.has_plan },
        { label: "Responsável definido", done: !!item.owner_master_user_id },
      ];
    case "call":
      return [
        { label: "WhatsApp conectado", done: g.whatsapp_connected },
        {
          label:
            g.pipelines_total === 0
              ? "Ao menos um funil ativo"
              : `Funis com etapa de ganho e de perda (${g.pipelines_won_lost} de ${g.pipelines_total})`,
          done: g.pipelines_total > 0 && g.pipelines_won_lost === g.pipelines_total,
        },
      ];
    case "concluido":
      return [{ label: "1ª venda registrada", done: g.first_sale }];
  }
}

export type StageVerdict = { ok: true } | { ok: false; reason: string; missing: Requirement[] };

export function canAdvance(item: ImplementacaoFacts, to: ImplementacaoStage): StageVerdict {
  const from = IMPLEMENTACAO_STAGES.indexOf(item.stage);
  const target = IMPLEMENTACAO_STAGES.indexOf(to);

  if (target === from) return { ok: false, reason: "A org já está nessa etapa.", missing: [] };
  if (item.stage === "concluido") {
    return { ok: false, reason: "Implantação concluída: a org segue em Organizações.", missing: [] };
  }
  // Voltar é permitido — algo quebrou depois da passagem (o chip caiu, o funil mudou).
  if (target < from) return { ok: true };
  if (target > from + 1) return { ok: false, reason: "Avance uma etapa por vez.", missing: [] };

  const missing = requirementsFor(item, to).filter((r) => !r.done);
  if (missing.length === 0) return { ok: true };
  return {
    ok: false,
    reason: `Falta: ${missing.map((r) => r.label.toLowerCase()).join(" e ")}.`,
    missing,
  };
}

export function nextStage(stage: ImplementacaoStage): ImplementacaoStage | null {
  const i = IMPLEMENTACAO_STAGES.indexOf(stage);
  return i < IMPLEMENTACAO_STAGES.length - 1 ? IMPLEMENTACAO_STAGES[i + 1] : null;
}

export function daysInStage(item: Pick<ImplementacaoFacts, "stage_entered_at">, now: Date = new Date()): number {
  return Math.floor((now.getTime() - new Date(item.stage_entered_at).getTime()) / 86_400_000);
}

/** IM-5: mais de 7 dias na mesma etapa — exceto quem já concluiu. */
export function isStale(item: Pick<ImplementacaoFacts, "stage" | "stage_entered_at">, now: Date = new Date()): boolean {
  return item.stage !== "concluido" && daysInStage(item, now) > STALE_STAGE_DAYS;
}

export function checklistDone(gates: Pick<ImplementacaoGates, "checklist">): number {
  if (!gates.checklist) return 0;
  return CHECKLIST_STEPS.filter(([k]) => gates.checklist?.[k]).length;
}
