/**
 * Pure mapping functions for PlaygroundFunis state <-> agent payload.
 *
 * No React deps -- testable in Node vitest.
 */

import type { MoveRule } from "@/types/copilot";

// ── UI State ──

export interface FunisState {
  activePipes: string[];
  activeStages: Record<string, string[]>; // pipeValue -> stageIds
  moveRules: FunisMoveRule[];
}

export interface FunisMoveRule {
  fromPipe: string;
  fromStage: string;
  condition: FunisCondition;
  toPipe: string;
  toStage: string;
}

export type FunisCondition =
  | "qualification_met"
  | "meeting_scheduled"
  | "objective_completed";

// ── Condition mapping ──

const CONDITION_TO_DB: Record<FunisCondition, MoveRule["condition"]> = {
  qualification_met: "qualified",
  meeting_scheduled: "objective_met",
  objective_completed: "objective_met",
};

const DB_TO_CONDITION: Record<MoveRule["condition"], FunisCondition> = {
  qualified: "qualification_met",
  objective_met: "objective_completed",
};

// ── Payload shape (matches useUpdateCopilotAgentPipeline) ──

export interface FunisPayload {
  activePipes: string[];
  activeStages: Record<string, string[]>;
  moveRules: MoveRule[];
}

// ── Mappers ──

export function funisStateToPayload(state: FunisState): FunisPayload {
  return {
    activePipes: state.activePipes,
    activeStages: state.activeStages,
    moveRules: state.moveRules.map((r) => ({
      from: { pipe: r.fromPipe, stage: r.fromStage },
      to: { pipe: r.toPipe, stage: r.toStage },
      condition: CONDITION_TO_DB[r.condition] ?? "objective_met",
    })),
  };
}

export function payloadToFunisState(agent: {
  active_pipes?: string[] | null;
  active_stages?: Record<string, string[]> | null;
  move_rules?: MoveRule[] | null;
}): FunisState {
  return {
    activePipes: (agent.active_pipes as string[]) || [],
    activeStages: (agent.active_stages as Record<string, string[]>) || {},
    moveRules: ((agent.move_rules as MoveRule[]) || []).map((r) => ({
      fromPipe: r.from.pipe,
      fromStage: r.from.stage,
      condition: DB_TO_CONDITION[r.condition] ?? "objective_completed",
      toPipe: r.to.pipe,
      toStage: r.to.stage,
    })),
  };
}

export const FUNIS_CONDITIONS: { value: FunisCondition; label: string }[] = [
  { value: "qualification_met", label: "Lead qualificado" },
  { value: "meeting_scheduled", label: "Reuniao agendada" },
  { value: "objective_completed", label: "Objetivo concluido" },
];

export function createEmptyFunisState(): FunisState {
  return { activePipes: [], activeStages: {}, moveRules: [] };
}
