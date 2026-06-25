/**
 * wizard-machine — pure state core for the Disparos "Wizard Linear" (#904).
 *
 * The Disparos creation flow is a linear, one-decision-per-screen wizard
 * (Pra quem · Mensagem · Velocidade · Revisão · Acompanhar). All navigation and
 * gating logic lives here as pure functions so it can be unit-tested without
 * React; `useDisparoWizard` is the thin `useReducer` shell over it.
 *
 * Gating rule: you can always step back to any reached step, and forward only
 * through a step whose own data is valid (`validateStep`). The Revisão →
 * Acompanhar transition goes through RELEASE (the actual dispatch is wired in
 * #910 — here it just flips `released` and advances to the monitor step).
 */
import type { BlastMediaType } from "@/modules/communication";
import { createDefaultSelection, type AudienceSelection } from "./audience-resolve";
import { CAP_RECOMMENDED } from "./speed-safety";

export type DisparoStepId =
  | "audience"
  | "message"
  | "speed"
  | "review"
  | "monitor";

export const DISPARO_STEPS: { id: DisparoStepId; label: string }[] = [
  { id: "audience", label: "Pra quem" },
  { id: "message", label: "Mensagem" },
  { id: "speed", label: "Velocidade" },
  { id: "review", label: "Revisão" },
  { id: "monitor", label: "Acompanhar" },
];

export const LAST_STEP_INDEX = DISPARO_STEPS.length - 1;

export interface DisparoNumber {
  id: string;
  label: string;
  /** Effective Number Daily Cap — max sends/day (after the new-number clamp). */
  cap: number;
  selected: boolean;
  /** A freshly connected number: auto-clamped below the slider (#908). */
  isNew?: boolean;
}

export interface DisparoMedia {
  type: BlastMediaType;
  sizeBytes: number;
  name: string;
  /** Public storage URL once uploaded (#910 dispatch); null while pending. */
  url?: string | null;
}

export interface DisparoDraft {
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
  media: DisparoMedia | null;
  /** Set by the Mensagem step when an attachment fails `validateBlastMedia`. */
  mediaError: string | null;
  /** Anti-ban protection (word + timing variation). On by default (#907). */
  antiBan: boolean;
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
    case "message":
      if (draft.message.trim() === "")
        return { ok: false, reason: "Escreva a mensagem." };
      if (draft.mediaError)
        return { ok: false, reason: draft.mediaError };
      return { ok: true, reason: null };
    case "speed":
      return selectedDailyCapacity(draft) > 0
        ? { ok: true, reason: null }
        : { ok: false, reason: "Selecione ao menos um número." };
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
      audience: createDefaultSelection(),
      audienceLabel: "",
      audienceCount: 0,
      leadIds: [],
      audienceSource: null,
      message: "",
      media: null,
      mediaError: null,
      antiBan: true,
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
