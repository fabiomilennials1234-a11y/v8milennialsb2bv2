/**
 * copilot-tool-registry.test.ts
 *
 * TDD cycles for issue #225: align frontend PLAYGROUND_TOOLS with backend actions.
 */

import { describe, it, expect } from "vitest";
import {
  PLAYGROUND_TOOLS,
  createDefaultPlaygroundData,
  LEGACY_TOOL_IDS,
} from "@/components/copilot/playground/types";
import { filterLegacyTools, isMoverCardAutoEnabled } from "@/components/copilot/playground/types";

describe("PLAYGROUND_TOOLS registry", () => {
  // Cycle 1: removed tools
  it("does NOT contain RESPONDER_FAQ (no backend action)", () => {
    const ids = PLAYGROUND_TOOLS.map((t) => t.id);
    expect(ids).not.toContain("RESPONDER_FAQ");
  });

  it("does NOT contain ENVIAR_FOLLOWUP (cron-based, not LLM tool)", () => {
    const ids = PLAYGROUND_TOOLS.map((t) => t.id);
    expect(ids).not.toContain("ENVIAR_FOLLOWUP");
  });

  // Cycle 2: ENVIAR_DOCUMENTO maps to backend send_document
  it("contains ENVIAR_DOCUMENTO with document_id and caption parameters", () => {
    const tool = PLAYGROUND_TOOLS.find((t) => t.id === "ENVIAR_DOCUMENTO");
    expect(tool).toBeDefined();
    expect(tool!.description).toContain("documento");

    const paramKeys = tool!.parameters.map((p) => p.key);
    expect(paramKeys).toContain("document_id");
    expect(paramKeys).toContain("caption");
  });

  // Cycle 3: TRANSFERIR_SZ_CHAT maps to backend transfer_sz_chat
  it("contains TRANSFERIR_SZ_CHAT with no required parameters", () => {
    const tool = PLAYGROUND_TOOLS.find((t) => t.id === "TRANSFERIR_SZ_CHAT");
    expect(tool).toBeDefined();
    expect(tool!.description).toMatch(/transfer|sz.?chat/i);
    // No required parameters — backend resolves team from config
    expect(tool!.parameters).toHaveLength(0);
  });

  // Cycle 4: graceful fallback for legacy tools in saved config
  it("LEGACY_TOOL_IDS contains removed tool IDs", () => {
    expect(LEGACY_TOOL_IDS).toContain("RESPONDER_FAQ");
    expect(LEGACY_TOOL_IDS).toContain("ENVIAR_FOLLOWUP");
  });

  it("filterLegacyTools strips removed tool IDs from tools record", () => {
    const toolsWithLegacy: Record<string, any> = {
      QUALIFICAR_LEAD: { enabled: true, config: {}, instruction: "" },
      RESPONDER_FAQ: { enabled: true, config: {}, instruction: "old" },
      ENVIAR_FOLLOWUP: { enabled: true, config: {}, instruction: "old" },
    };

    const cleaned = filterLegacyTools(toolsWithLegacy);
    expect(Object.keys(cleaned)).not.toContain("RESPONDER_FAQ");
    expect(Object.keys(cleaned)).not.toContain("ENVIAR_FOLLOWUP");
    expect(Object.keys(cleaned)).toContain("QUALIFICAR_LEAD");
  });

  // Cycle 5: MOVER_CARD auto-enable when active_pipes present
  it("isMoverCardAutoEnabled returns true when active_pipes has entries", () => {
    expect(isMoverCardAutoEnabled(["whatsapp", "confirmacao"])).toBe(true);
  });

  it("isMoverCardAutoEnabled returns false when active_pipes is empty", () => {
    expect(isMoverCardAutoEnabled([])).toBe(false);
  });

  it("isMoverCardAutoEnabled returns false when active_pipes is undefined", () => {
    expect(isMoverCardAutoEnabled(undefined)).toBe(false);
  });

  // Ensure preserved tools still present
  it("preserves all expected tool IDs", () => {
    const ids = PLAYGROUND_TOOLS.map((t) => t.id);
    const expected = [
      "QUALIFICAR_LEAD",
      "AGENDAR_REUNIAO",
      "MOVER_CARD",
      "TRANSFERIR_HUMANO",
      "CRIAR_LEAD",
      "PREENCHER_CAMPOS",
      "TRANSFERIR_SZ_CHAT",
      "ENVIAR_DOCUMENTO",
      "CRIAR_CAMPO",
      "PAUSAR_ATENDIMENTO_HUMANO",
    ];
    for (const toolId of expected) {
      expect(ids).toContain(toolId);
    }
    // Total count = 10
    expect(PLAYGROUND_TOOLS).toHaveLength(10);
  });
});
