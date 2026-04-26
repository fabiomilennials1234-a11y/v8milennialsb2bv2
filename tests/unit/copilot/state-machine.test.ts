/**
 * Tests for _shared/copilot/state-machine.ts
 * Pure functions — sem mock de banco necessário.
 */

import { describe, it, expect } from "vitest";
import "../../helpers/deno-mock";
import {
  determineNextState,
  isValidTransition,
  VALID_TRANSITIONS,
  type ConversationState,
} from "../../../supabase/functions/_shared/copilot/state-machine.ts";

describe("determineNextState", () => {
  it("schedule_meeting → SCHEDULED", () => {
    expect(determineNextState("QUALIFYING", "schedule_meeting")).toBe("SCHEDULED");
    expect(determineNextState("NEW_LEAD", "schedule_meeting")).toBe("SCHEDULED");
  });

  it("transfer_to_human → WAITING_HUMAN", () => {
    expect(determineNextState("QUALIFYING", "transfer_to_human")).toBe("WAITING_HUMAN");
  });

  it("qualify_lead → QUALIFIED", () => {
    expect(determineNextState("NEW_LEAD", "qualify_lead")).toBe("QUALIFIED");
  });

  it("disqualify_lead → DISQUALIFIED", () => {
    expect(determineNextState("QUALIFYING", "disqualify_lead")).toBe("DISQUALIFIED");
  });

  it("confirm_meeting → QUALIFIED (dispara onQualify automation)", () => {
    expect(determineNextState("SCHEDULED", "confirm_meeting")).toBe("QUALIFIED");
  });

  it("transfer_sz_chat → CLOSED_WON", () => {
    expect(determineNextState("QUALIFIED", "transfer_sz_chat")).toBe("CLOSED_WON");
  });

  it("ações no-op (advance_stage, advance_confirmation_stage, create_custom_field, send_*, search_knowledge) mantêm estado", () => {
    const noOps = [
      "advance_stage",
      "advance_confirmation_stage",
      "create_custom_field",
      "send_document",
      "send_product_material",
      "search_knowledge",
    ];
    for (const tool of noOps) {
      expect(determineNextState("QUALIFYING", tool)).toBe("QUALIFYING");
      expect(determineNextState("SCHEDULED", tool)).toBe("SCHEDULED");
    }
  });

  it("NEW_LEAD com tool desconhecido → QUALIFYING (auto-advance)", () => {
    expect(determineNextState("NEW_LEAD", "unknown_tool")).toBe("QUALIFYING");
  });

  it("qualquer estado com tool desconhecido (não NEW_LEAD) mantém estado", () => {
    expect(determineNextState("QUALIFYING", "unknown")).toBe("QUALIFYING");
    expect(determineNextState("SCHEDULED", "unknown")).toBe("SCHEDULED");
    expect(determineNextState("WAITING_HUMAN", "unknown")).toBe("WAITING_HUMAN");
  });
});

describe("isValidTransition", () => {
  it("NEW_LEAD → QUALIFYING válido", () => {
    expect(isValidTransition("NEW_LEAD", "QUALIFYING")).toBe(true);
  });

  it("NEW_LEAD → WAITING_HUMAN válido", () => {
    expect(isValidTransition("NEW_LEAD", "WAITING_HUMAN")).toBe(true);
  });

  it("NEW_LEAD → CLOSED_WON inválido (precisa passar QUALIFIED)", () => {
    expect(isValidTransition("NEW_LEAD", "CLOSED_WON")).toBe(false);
  });

  it("DISQUALIFIED é absorbing state (nenhuma transição permitida)", () => {
    const allStates: ConversationState[] = [
      "NEW_LEAD",
      "QUALIFYING",
      "QUALIFIED",
      "SCHEDULING",
      "SCHEDULED",
      "FOLLOW_UP",
      "WAITING_HUMAN",
      "CLOSED_WON",
      "CLOSED_LOST",
    ];
    for (const target of allStates) {
      expect(isValidTransition("DISQUALIFIED", target)).toBe(false);
    }
  });

  it("CLOSED_WON é absorbing state", () => {
    expect(isValidTransition("CLOSED_WON", "QUALIFYING")).toBe(false);
    expect(isValidTransition("CLOSED_WON", "SCHEDULED")).toBe(false);
  });

  it("WAITING_HUMAN pode voltar pra qualquer estado de qualificação", () => {
    expect(isValidTransition("WAITING_HUMAN", "QUALIFYING")).toBe(true);
    expect(isValidTransition("WAITING_HUMAN", "QUALIFIED")).toBe(true);
    expect(isValidTransition("WAITING_HUMAN", "SCHEDULED")).toBe(true);
    expect(isValidTransition("WAITING_HUMAN", "CLOSED_WON")).toBe(true);
    expect(isValidTransition("WAITING_HUMAN", "CLOSED_LOST")).toBe(true);
  });
});

describe("VALID_TRANSITIONS map", () => {
  it("tem entrada pra todos 10 estados conhecidos", () => {
    const expected: ConversationState[] = [
      "NEW_LEAD",
      "QUALIFYING",
      "QUALIFIED",
      "DISQUALIFIED",
      "SCHEDULING",
      "SCHEDULED",
      "FOLLOW_UP",
      "WAITING_HUMAN",
      "CLOSED_WON",
      "CLOSED_LOST",
    ];
    for (const state of expected) {
      expect(VALID_TRANSITIONS[state]).toBeDefined();
    }
  });

  it("estados absorbing (DISQUALIFIED, CLOSED_WON, CLOSED_LOST) têm array vazio", () => {
    expect(VALID_TRANSITIONS.DISQUALIFIED).toEqual([]);
    expect(VALID_TRANSITIONS.CLOSED_WON).toEqual([]);
    expect(VALID_TRANSITIONS.CLOSED_LOST).toEqual([]);
  });
});
