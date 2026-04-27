/**
 * Tests for _shared/copilot/dispatcher.ts
 * Pure functions (buildIdempotencyKey, mapToolToAction, mapActionToType).
 * addMessageToMemory + logDecision testados separadamente (precisam mock supabase).
 */

import { describe, it, expect } from "vitest";
import "../../helpers/deno-mock";
import {
  buildIdempotencyKey,
  mapToolToAction,
  mapActionToType,
  ACTION_MAP,
} from "../../../supabase/functions/_shared/copilot/dispatcher.ts";

const ORG = "00000000-0000-0000-0000-000000000001";
const LEAD = "11111111-1111-1111-1111-111111111111";

describe("buildIdempotencyKey", () => {
  it("schedule_meeting usa preferred_date (estável entre tentativas)", () => {
    const k1 = buildIdempotencyKey("schedule_meeting", LEAD, ORG, { preferred_date: "2026-05-01T10:00:00Z" });
    const k2 = buildIdempotencyKey("schedule_meeting", LEAD, ORG, { preferred_date: "2026-05-01T10:00:00Z" });
    expect(k1).toBe(k2);
    expect(k1).toContain("schedule_meeting");
    expect(k1).toContain(LEAD);
  });

  it("transfer_to_human é único por lead (sem ts/turn)", () => {
    const k1 = buildIdempotencyKey("transfer_to_human", LEAD, ORG, {});
    const k2 = buildIdempotencyKey("transfer_to_human", LEAD, ORG, {});
    expect(k1).toBe(k2);
    expect(k1).toBe(`transfer_human_${LEAD}`);
  });

  it("turn_count quando fornecido prevalece sobre timestamp", () => {
    const k1 = buildIdempotencyKey("update_lead", LEAD, ORG, { foo: "bar" }, 5);
    expect(k1).toContain("t5");
    expect(k1).not.toContain("ts");
  });

  it("fallback ts (1min bucket) quando turnCount ausente", () => {
    const k = buildIdempotencyKey("update_lead", LEAD, ORG, {});
    expect(k).toMatch(/ts\d+/);
  });

  it("advance_stage inclui target_pipe + target_stage", () => {
    const k = buildIdempotencyKey("advance_stage", LEAD, ORG, { target_pipe: "confirmacao", target_stage: "d3" });
    expect(k).toContain("confirmacao");
    expect(k).toContain("d3");
  });

  it("create_custom_field usa orgId em vez de leadId", () => {
    const k = buildIdempotencyKey("create_custom_field", null, ORG, { field_name: "cnpj" });
    expect(k).toContain(ORG);
    expect(k).toContain("cnpj");
  });

  it("default action sem leadId usa orgId", () => {
    const k = buildIdempotencyKey("send_document", null, ORG, {});
    expect(k).toContain(ORG);
    expect(k).toContain("send_document");
  });

  it("default action com leadId usa leadId", () => {
    const k = buildIdempotencyKey("send_document", LEAD, ORG, {});
    expect(k).toContain(LEAD);
    expect(k).not.toContain(ORG);
  });
});

describe("mapToolToAction", () => {
  it("mapeia 16 tools conhecidos pra UPPER_SNAKE", () => {
    expect(mapToolToAction("schedule_meeting")).toBe("SCHEDULE_MEETING");
    expect(mapToolToAction("create_lead")).toBe("CREATE_LEAD");
    expect(mapToolToAction("transfer_to_human")).toBe("TRANSFER_HUMAN");
    expect(mapToolToAction("update_qualification_score")).toBe("UPDATE_QUALIFICATION_SCORE");
    expect(mapToolToAction("send_product_material")).toBe("SEND_PRODUCT_MATERIAL");
    expect(mapToolToAction("search_knowledge")).toBe("SEARCH_KNOWLEDGE");
  });

  it("tool desconhecido → UNKNOWN", () => {
    expect(mapToolToAction("inexistente")).toBe("UNKNOWN");
    expect(mapToolToAction("")).toBe("UNKNOWN");
  });
});

describe("mapActionToType (ACTION_MAP inverso)", () => {
  it("mapeia UPPER_SNAKE → snake_case action_type DB", () => {
    expect(mapActionToType("SCHEDULE_MEETING")).toBe("schedule_meeting");
    expect(mapActionToType("TRANSFER_HUMAN")).toBe("transfer_to_human");
    expect(mapActionToType("ADVANCE_STAGE")).toBe("advance_stage");
  });

  it("UPPER_SNAKE desconhecido → null", () => {
    expect(mapActionToType("INEXISTENTE")).toBeNull();
  });
});

describe("ACTION_MAP completude", () => {
  it("contém entradas pra todos 18 LLM action UPPER", () => {
    const expected = [
      "SCHEDULE_MEETING",
      "CREATE_LEAD",
      "UPDATE_CRM",
      "UPDATE_LEAD",
      "TRANSFER_HUMAN",
      "TRANSFER_HUMAN_NOTIFY",
      "UPDATE_QUALIFICATION_SCORE",
      "ADVANCE_STAGE",
      "CONFIRM_MEETING",
      "ADVANCE_CONFIRMATION_STAGE",
      "CREATE_CUSTOM_FIELD",
      "UPDATE_PIPELINE_STAGE",
      "TRANSFER_SZ_CHAT",
      "SEND_DOCUMENT",
      "AUTOMATION_QUALIFY",
      "AUTOMATION_DISQUALIFY",
      "AUTOMATION_NEED_HUMAN",
      "SEND_PRODUCT_MATERIAL",
    ];
    for (const action of expected) {
      expect(ACTION_MAP[action]).toBeDefined();
    }
  });
});
