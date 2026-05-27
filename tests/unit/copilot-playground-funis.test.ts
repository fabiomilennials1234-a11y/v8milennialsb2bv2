// @vitest-environment node
/**
 * Unit tests for PlaygroundFunis mapping functions.
 *
 * Pure functions that convert between FunisState (UI state)
 * and agent payload (DB shape). No React, no hooks.
 */

import { describe, it, expect } from "vitest";
import {
  funisStateToPayload,
  payloadToFunisState,
  type FunisState,
} from "@/modules/copilot/components/playground/funis-mapping";

describe("funisStateToPayload", () => {
  it("maps activePipes, activeStages, moveRules to agent payload shape", () => {
    const state: FunisState = {
      activePipes: ["whatsapp", "confirmacao"],
      activeStages: {
        whatsapp: ["novo", "abordado"],
        confirmacao: ["reuniao_marcada"],
      },
      moveRules: [
        {
          fromPipe: "whatsapp",
          fromStage: "abordado",
          condition: "qualification_met",
          toPipe: "confirmacao",
          toStage: "reuniao_marcada",
        },
      ],
    };

    const payload = funisStateToPayload(state);

    expect(payload.activePipes).toEqual(["whatsapp", "confirmacao"]);
    expect(payload.activeStages).toEqual({
      whatsapp: ["novo", "abordado"],
      confirmacao: ["reuniao_marcada"],
    });
    expect(payload.moveRules).toEqual([
      {
        from: { pipe: "whatsapp", stage: "abordado" },
        to: { pipe: "confirmacao", stage: "reuniao_marcada" },
        condition: "qualified",
      },
    ]);
  });
});

describe("payloadToFunisState (edit mode round-trip)", () => {
  it("converts agent DB shape back to FunisState", () => {
    const agentData = {
      active_pipes: ["whatsapp", "propostas"],
      active_stages: {
        whatsapp: ["novo", "respondeu"],
        propostas: ["proposta_enviada"],
      },
      move_rules: [
        {
          from: { pipe: "whatsapp", stage: "respondeu" },
          to: { pipe: "propostas", stage: "proposta_enviada" },
          condition: "objective_met",
        },
      ],
    };

    const state = payloadToFunisState(agentData);

    expect(state.activePipes).toEqual(["whatsapp", "propostas"]);
    expect(state.activeStages).toEqual({
      whatsapp: ["novo", "respondeu"],
      propostas: ["proposta_enviada"],
    });
    expect(state.moveRules).toEqual([
      {
        fromPipe: "whatsapp",
        fromStage: "respondeu",
        condition: "objective_completed",
        toPipe: "propostas",
        toStage: "proposta_enviada",
      },
    ]);
  });
});

describe("empty FunisState", () => {
  it("produces empty arrays when no pipes selected", () => {
    const state: FunisState = {
      activePipes: [],
      activeStages: {},
      moveRules: [],
    };

    const payload = funisStateToPayload(state);

    expect(payload.activePipes).toEqual([]);
    expect(payload.activeStages).toEqual({});
    expect(payload.moveRules).toEqual([]);
  });

  it("round-trips empty payload back to empty state", () => {
    const agentData = {
      active_pipes: null,
      active_stages: null,
      move_rules: null,
    };

    const state = payloadToFunisState(agentData);

    expect(state.activePipes).toEqual([]);
    expect(state.activeStages).toEqual({});
    expect(state.moveRules).toEqual([]);
  });
});
