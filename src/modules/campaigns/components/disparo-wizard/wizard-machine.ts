/**
 * wizard-machine — pure state core for the Disparos "Wizard Linear" (#904).
 *
 * The Disparos creation flow is a linear, one-decision-per-screen wizard
 * (Pra quem · Velocidade · Mensagem · Destino · Revisão · Acompanhar — a ordem
 * mudou em #1722: o regime vem antes do conteúdo). All
 * navigation and gating logic lives here as pure functions so it can be
 * unit-tested without React; `useDisparoWizard` is the thin `useReducer` shell
 * over it.
 *
 * Gating rule: you can always step back to any reached step, and forward only
 * through a step whose own data is valid (`validateStep`). The Revisão →
 * Acompanhar transition goes through RELEASE (the actual dispatch is wired in
 * #910 — here it just flips `released` and advances to the monitor step).
 */
import type { BlastMediaType } from "@/modules/communication";
import {
  createDefaultSelection,
  type AudienceSelection,
} from "./audience-resolve";
import { CAP_RECOMMENDED } from "@/shared/disparo/speed-safety";

export type DisparoStepId =
  | "audience"
  | "message"
  | "postsend"
  | "speed"
  | "review"
  | "monitor";

export const DISPARO_STEPS: { id: DisparoStepId; label: string }[] = [
  { id: "audience", label: "Pra quem" },
  // O número vem ANTES do conteúdo (#1722). A Instance escolhida decide o
  // REGIME, e o regime decide o que o passo de conteúdo pede: texto livre no
  // Chip, Template aprovado no Canal Oficial (ADR-0028 §1). Na ordem anterior
  // — conteúdo no passo 2, número no passo 4 — trocar o número invalidaria uma
  // mensagem já escrita, e o custo caía no operador.
  //
  // São os MESMOS seis passos, com os MESMOS rótulos: para quem só tem Chip,
  // muda a posição de uma tela e nada mais (critério 8).
  { id: "speed", label: "Velocidade" },
  { id: "message", label: "Mensagem" },
  { id: "postsend", label: "Destino" },
  { id: "review", label: "Revisão" },
  { id: "monitor", label: "Acompanhar" },
];

export const LAST_STEP_INDEX = DISPARO_STEPS.length - 1;

/**
 * O rótulo "Passo N de 6", DERIVADO da posição real.
 *
 * Era literal em cada um dos cinco passos, e a reordenação do #1722 fez os cinco
 * mentirem de uma vez — "Mensagem" seguia anunciando "Passo 2" depois de virar o
 * terceiro. A tela não reclama de um número errado: ela só mente. Derivar é o
 * que impede a próxima reordenação de repetir isso.
 */
export function kickerDoPasso(id: DisparoStepId): string {
  const i = DISPARO_STEPS.findIndex((s) => s.id === id);
  return `Passo ${i + 1} de ${DISPARO_STEPS.length}`;
}

/**
 * O número do Disparo e o regime que ele impõe ao conteúdo vivem no módulo
 * ÚNICO (`@/shared/disparo/disparo-numbers`), porque o Disparo Rápido consulta o mesmo
 * contrato (#1722). Aqui só se reexporta, para os passos do wizard não
 * precisarem saber onde ele mora.
 */
export type { DisparoNumber, RegimeDeDisparo } from "@/shared/disparo/disparo-numbers";
import type { DisparoNumber, RegimeDeDisparo } from "@/shared/disparo/disparo-numbers";

/**
 * O Template aprovado escolhido no passo de conteúdo também vive fora daqui
 * (#1846): `useBlastPlans` precisa do mesmo contrato para persistir
 * `blast_plans.template`, e importá-lo do wizard fechava o ciclo
 * campaigns ↔ pipelines. Reexportado para os passos não mudarem de import.
 */
export type { TemplateEscolhido } from "@/shared/disparo/template-escolhido";
import type { TemplateEscolhido } from "@/shared/disparo/template-escolhido";

export interface DisparoMedia {
  type: BlastMediaType;
  sizeBytes: number;
  name: string;
  /** Public storage URL once uploaded (#910 dispatch); null while pending. */
  url?: string | null;
}

/** Where the frozen audience came from. Defaults to "estagio" (the #902 picker). */
export type AudienceSourceType = "estagio" | "planilha";

export interface DisparoDraft {
  /** Which audience source the user chose (#906 adds "planilha"). */
  audienceSourceType: AudienceSourceType;
  /** Funnel/stage/conditions the audience is drawn from (#902). */
  audience: AudienceSelection;
  /** Human label for the chosen source, shown in Review. */
  audienceLabel: string;
  /** Live resolved size — gates the step and drives the "X contatos" readouts. */
  audienceCount: number;
  /** Frozen resolved lead ids — the dispatch payload (#910). */
  leadIds: string[];
  /** Audience provenance recorded on the Blast Plan (#910). */
  audienceSource: Record<string, unknown> | null;
  message: string;
  /**
   * O Template aprovado, quando o regime é Canal Oficial (#1722). `null` no
   * Chip. Sem variáveis nesta fatia — o mapeamento por destinatário é #1723.
   */
  template: TemplateEscolhido | null;
  media: DisparoMedia | null;
  /** Set by the Mensagem step when an attachment fails `validateBlastMedia`. */
  mediaError: string | null;
  /** Anti-ban protection (word + timing variation). On by default (#907). */
  antiBan: boolean;
  /** Post-send destination: move each lead when ITS message goes out. Default
   *  "none" — the step is optional and passes untouched. */
  postSendMode: "none" | "move";
  /** Destination funnel (`pipelines.id`, QUALQUER funil da org — Fatia B).
   *  Sempre UM funil concreto: o escopo "todos os funis" é de LEITURA de
   *  público, nunca de escrita — um lead não pode ser movido pra "todo funil".
   *  null = not chosen. */
  postSendPipelineId: string | null;
  /** Destination stage (`pipeline_stages.id`, uuid canônico de qualquer
   *  funil). "" = nothing chosen yet. */
  postSendStageId: string;
  /** Human label, e.g. "Oportunidades · Em negociação" (Review/Monitor copy). */
  postSendLabel: string;
  numbers: DisparoNumber[];
  /** User-set Number Daily Cap applied to every selected number (#908 slider). */
  capPerNumber: number;
  /** YYYY-MM-DD the plan starts (passed in — the machine is clock-free). */
  startDateIso: string;
  /** Flipped by RELEASE — the blast was "fired" (real dispatch is #910). */
  released: boolean;
}

export interface WizardState {
  index: number;
  /** Furthest step reached — bounds forward jumps via the progress bar. */
  furthest: number;
  draft: DisparoDraft;
}

export type WizardAction =
  | { type: "NEXT" }
  | { type: "BACK" }
  | { type: "GOTO"; index: number }
  | { type: "PATCH"; patch: Partial<DisparoDraft> }
  | { type: "RELEASE" };

export interface StepValidation {
  ok: boolean;
  reason: string | null;
}

/**
 * Os regimes presentes na seleção. Mais de um = seleção incoerente (#1722).
 *
 * Números antigos, gravados antes de o regime existir, contam como `chip` — era
 * o único regime que o Disparo tinha.
 */
export function regimesSelecionados(draft: DisparoDraft): Set<RegimeDeDisparo> {
  return new Set(
    draft.numbers.filter((n) => n.selected).map((n) => n.regime ?? "chip"),
  );
}

/**
 * O regime do conteúdo deste Disparo.
 *
 * Seleção sem número, ou de regimes misturados (que `validateStep("speed")`
 * recusa), responde `chip` — o regime que o Disparo sempre teve. Fail-closed
 * para o lado que não exige Template.
 */
export function regimeDoConteudo(draft: DisparoDraft): RegimeDeDisparo {
  const regimes = regimesSelecionados(draft);
  return regimes.size === 1 && regimes.has("oficial") ? "oficial" : "chip";
}

/** Combined daily capacity = Σ of the selected numbers' caps. */
export function selectedDailyCapacity(draft: DisparoDraft): number {
  return draft.numbers
    .filter((n) => n.selected)
    .reduce((sum, n) => sum + Math.max(0, Math.floor(n.cap)), 0);
}

/** Per-step gate. A step is "complete" when its own decision is valid. */
export function validateStep(
  id: DisparoStepId,
  draft: DisparoDraft,
): StepValidation {
  switch (id) {
    case "audience":
      return draft.audienceCount > 0
        ? { ok: true, reason: null }
        : { ok: false, reason: "Escolha pra quem enviar." };
    case "message": {
      // No Canal Oficial o conteúdo NÃO é texto: quem recebe um Disparo está
      // fora da janela de 24 horas, e fora dela a Meta só aceita Template
      // aprovado. Deixar passar texto livre aqui viraria recusa do fornecedor
      // no envio — em massa, com a audiência já congelada.
      if (regimeDoConteudo(draft) === "oficial") {
        return draft.template
          ? { ok: true, reason: null }
          : { ok: false, reason: "Escolha um Template aprovado." };
      }
      if (draft.message.trim() === "")
        return { ok: false, reason: "Escreva a mensagem." };
      if (draft.mediaError)
        return { ok: false, reason: draft.mediaError };
      return { ok: true, reason: null };
    }
    case "postsend":
      // Optional step: "manter onde estão" always passes; moving requires a
      // chosen destination stage.
      if (draft.postSendMode === "move" && !draft.postSendStageId)
        return { ok: false, reason: "Escolha a etapa de destino." };
      return { ok: true, reason: null };
    case "speed": {
      if (selectedDailyCapacity(draft) <= 0)
        return { ok: false, reason: "Selecione ao menos um número." };
      // Um Disparo tem UM conteúdo, e o regime o decide (ADR-0028 §1): Chip
      // manda texto livre, Canal Oficial manda Template aprovado. Misturar os
      // dois pediria duas mensagens no mesmo Disparo.
      return regimesSelecionados(draft).size > 1
        ? {
            ok: false,
            reason:
              "Escolha números de um regime só: o Canal Oficial manda Template aprovado e o Chip manda texto livre.",
          }
        : { ok: true, reason: null };
    }
    case "review":
      return { ok: true, reason: null };
    case "monitor":
      return { ok: true, reason: null };
  }
}

/** Whether the wizard may advance from its current step. */
export function canAdvance(state: WizardState): boolean {
  if (state.index >= LAST_STEP_INDEX) return false;
  return validateStep(DISPARO_STEPS[state.index].id, state.draft).ok;
}

export function createInitialState(
  startDateIso: string,
  numbers: DisparoNumber[] = [],
): WizardState {
  return {
    index: 0,
    furthest: 0,
    draft: {
      audienceSourceType: "estagio",
      audience: createDefaultSelection(),
      audienceLabel: "",
      audienceCount: 0,
      leadIds: [],
      audienceSource: null,
      message: "",
      template: null,
      media: null,
      mediaError: null,
      antiBan: true,
      postSendMode: "none",
      postSendPipelineId: null,
      postSendStageId: "",
      postSendLabel: "",
      numbers,
      capPerNumber: CAP_RECOMMENDED,
      startDateIso,
      released: false,
    },
  };
}

export function wizardReducer(
  state: WizardState,
  action: WizardAction,
): WizardState {
  switch (action.type) {
    case "NEXT": {
      if (!canAdvance(state)) return state;
      const index = state.index + 1;
      return { ...state, index, furthest: Math.max(state.furthest, index) };
    }
    case "BACK": {
      if (state.index === 0) return state;
      return { ...state, index: state.index - 1 };
    }
    case "GOTO": {
      // Back to any reached step; forward only up to the furthest reached.
      const clamped = Math.max(0, Math.min(action.index, state.furthest));
      return { ...state, index: clamped };
    }
    case "PATCH": {
      return { ...state, draft: { ...state.draft, ...action.patch } };
    }
    case "RELEASE": {
      return {
        ...state,
        index: LAST_STEP_INDEX,
        furthest: LAST_STEP_INDEX,
        draft: { ...state.draft, released: true },
      };
    }
  }
}
