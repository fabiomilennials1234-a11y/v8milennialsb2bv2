import { describe, it, expect } from "vitest";
import {
  formatToolCallsForDryRun,
  buildPreviewTools,
  type OpenRouterToolCall,
} from "@/lib/copilot/dry-run-engine";

// =====================================================
// RED-GREEN Cycle 1: MOVER_CARD tool call → dry-run result
// =====================================================
describe("formatToolCallsForDryRun — MOVER_CARD", () => {
  it("converts advance_stage tool call to dry-run with humanDescription", () => {
    const toolCalls: OpenRouterToolCall[] = [
      {
        id: "call_1",
        type: "function",
        function: {
          name: "advance_stage",
          arguments: JSON.stringify({ target_stage: "agendado" }),
        },
      },
    ];

    const result = formatToolCallsForDryRun(toolCalls);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("advance_stage");
    expect(result[0].parameters).toEqual({ target_stage: "agendado" });
    expect(result[0].humanDescription).toContain("MOVER_CARD");
    expect(result[0].humanDescription).toContain("agendado");
  });

  it("includes pipe in humanDescription when target_pipe provided", () => {
    const toolCalls: OpenRouterToolCall[] = [
      {
        function: {
          name: "advance_stage",
          arguments: JSON.stringify({ target_stage: "respondeu", target_pipe: "confirmacao" }),
        },
      },
    ];

    const result = formatToolCallsForDryRun(toolCalls);
    expect(result[0].humanDescription).toContain("confirmacao");
    expect(result[0].humanDescription).toContain("respondeu");
  });
});

// =====================================================
// RED-GREEN Cycle 2: QUALIFICAR_LEAD with score
// =====================================================
describe("formatToolCallsForDryRun — QUALIFICAR_LEAD", () => {
  it("handles update_qualification_score with score parameter", () => {
    const toolCalls: OpenRouterToolCall[] = [
      {
        function: {
          name: "update_qualification_score",
          arguments: JSON.stringify({ score: 75, reason: "Tem orcamento e urgencia" }),
        },
      },
    ];

    const result = formatToolCallsForDryRun(toolCalls);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("update_qualification_score");
    expect(result[0].parameters.score).toBe(75);
    expect(result[0].humanDescription).toContain("QUALIFICAR_LEAD");
    expect(result[0].humanDescription).toContain("75");
  });

  it("handles qualify_lead action", () => {
    const toolCalls: OpenRouterToolCall[] = [
      {
        function: {
          name: "qualify_lead",
          arguments: JSON.stringify({ reason: "Perfil B2B confirmado" }),
        },
      },
    ];

    const result = formatToolCallsForDryRun(toolCalls);
    expect(result[0].humanDescription).toContain("qualificado");
  });

  it("handles disqualify_lead action", () => {
    const toolCalls: OpenRouterToolCall[] = [
      {
        function: {
          name: "disqualify_lead",
          arguments: JSON.stringify({ reason: "Fora do perfil" }),
        },
      },
    ];

    const result = formatToolCallsForDryRun(toolCalls);
    expect(result[0].humanDescription).toContain("DESQUALIFICAR_LEAD");
  });
});

// =====================================================
// RED-GREEN Cycle 3: Multiple tool calls in single response
// =====================================================
describe("formatToolCallsForDryRun — multiple tool calls", () => {
  it("formats all tool calls in the array", () => {
    const toolCalls: OpenRouterToolCall[] = [
      {
        function: {
          name: "update_qualification_score",
          arguments: JSON.stringify({ score: 85 }),
        },
      },
      {
        function: {
          name: "advance_stage",
          arguments: JSON.stringify({ target_stage: "qualificado" }),
        },
      },
      {
        function: {
          name: "schedule_meeting",
          arguments: JSON.stringify({ preferred_date: "2026-05-20", preferred_time: "14:00" }),
        },
      },
    ];

    const result = formatToolCallsForDryRun(toolCalls);

    expect(result).toHaveLength(3);
    expect(result[0].name).toBe("update_qualification_score");
    expect(result[1].name).toBe("advance_stage");
    expect(result[2].name).toBe("schedule_meeting");

    // Each has a humanDescription
    result.forEach((r) => {
      expect(r.humanDescription).toBeTruthy();
      expect(r.humanDescription.length).toBeGreaterThan(5);
    });

    // Schedule meeting includes date/time
    expect(result[2].humanDescription).toContain("2026-05-20");
    expect(result[2].humanDescription).toContain("14:00");
  });

  it("handles malformed JSON arguments gracefully", () => {
    const toolCalls: OpenRouterToolCall[] = [
      {
        function: {
          name: "advance_stage",
          arguments: "not valid json{",
        },
      },
    ];

    const result = formatToolCallsForDryRun(toolCalls);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("advance_stage");
    expect(result[0].parameters._raw).toBe("not valid json{");
  });
});

// =====================================================
// RED-GREEN Cycle 4: empty / undefined / null tool_calls
// =====================================================
describe("formatToolCallsForDryRun — empty input", () => {
  it("returns empty array when toolCalls is undefined", () => {
    expect(formatToolCallsForDryRun(undefined)).toEqual([]);
  });

  it("returns empty array when toolCalls is null", () => {
    expect(formatToolCallsForDryRun(null)).toEqual([]);
  });

  it("returns empty array when toolCalls is empty array", () => {
    expect(formatToolCallsForDryRun([])).toEqual([]);
  });
});

// =====================================================
// RED-GREEN Cycle 5: buildPreviewTools — only enabled tools
// =====================================================
describe("buildPreviewTools — enabled filtering", () => {
  it("only includes tools that are enabled", () => {
    const tools = {
      QUALIFICAR_LEAD: { enabled: true, config: {}, instruction: "" },
      AGENDAR_REUNIAO: { enabled: false, config: {}, instruction: "" },
      TRANSFERIR_HUMANO: { enabled: true, config: {}, instruction: "" },
    };

    const result = buildPreviewTools(tools);

    const names = result.map((t) => t.function.name);

    // QUALIFICAR_LEAD maps to 3 functions (update_qualification_score, qualify_lead, disqualify_lead)
    expect(names).toContain("update_qualification_score");
    expect(names).toContain("qualify_lead");
    expect(names).toContain("disqualify_lead");

    // TRANSFERIR_HUMANO maps to transfer_to_human
    expect(names).toContain("transfer_to_human");

    // AGENDAR_REUNIAO disabled → schedule_meeting NOT present
    expect(names).not.toContain("schedule_meeting");
    expect(names).not.toContain("confirm_meeting");
  });

  it("returns empty array when no tools enabled", () => {
    const tools = {
      QUALIFICAR_LEAD: { enabled: false, config: {}, instruction: "" },
      AGENDAR_REUNIAO: { enabled: false, config: {}, instruction: "" },
    };

    expect(buildPreviewTools(tools)).toEqual([]);
  });

  it("returns empty array for empty tools object", () => {
    expect(buildPreviewTools({})).toEqual([]);
  });

  it("all returned tool defs have type: function", () => {
    const tools = {
      QUALIFICAR_LEAD: { enabled: true, config: {}, instruction: "" },
      RESPONDER_FAQ: { enabled: true, config: {}, instruction: "" },
    };

    const result = buildPreviewTools(tools);
    result.forEach((t) => {
      expect(t.type).toBe("function");
      expect(t.function.name).toBeTruthy();
      expect(t.function.parameters.type).toBe("object");
    });
  });
});

// =====================================================
// RED-GREEN Cycle 6: MOVER_CARD excluded when no stages
// =====================================================
describe("buildPreviewTools — MOVER_CARD pipe/stage handling", () => {
  it("excludes MOVER_CARD when config has no stages", () => {
    const tools = {
      MOVER_CARD: { enabled: true, config: { pipe: "whatsapp", stages: "" }, instruction: "" },
    };

    const result = buildPreviewTools(tools);
    expect(result).toEqual([]);
  });

  it("excludes MOVER_CARD when config is empty", () => {
    const tools = {
      MOVER_CARD: { enabled: true, config: {}, instruction: "" },
    };

    const result = buildPreviewTools(tools);
    expect(result).toEqual([]);
  });

  it("includes MOVER_CARD with stages in description when config has stages", () => {
    const tools = {
      MOVER_CARD: {
        enabled: true,
        config: { pipe: "whatsapp", stages: "novo, abordado, respondeu, agendado" },
        instruction: "",
      },
    };

    const result = buildPreviewTools(tools);
    expect(result).toHaveLength(1);
    expect(result[0].function.name).toBe("advance_stage");
    expect(result[0].function.description).toContain("novo");
    expect(result[0].function.description).toContain("agendado");
    expect(result[0].function.description).toContain("whatsapp");
  });

  it("uses default pipe when pipe not specified in config", () => {
    const tools = {
      MOVER_CARD: {
        enabled: true,
        config: { stages: "novo, respondeu" },
        instruction: "",
      },
    };

    const result = buildPreviewTools(tools);
    expect(result).toHaveLength(1);
    // Default pipe is whatsapp
    expect(result[0].function.description).toContain("whatsapp");
  });
});

// =====================================================
// Extra coverage: other tool types humanDescription
// =====================================================
describe("formatToolCallsForDryRun — other tool types", () => {
  it("formats transfer_to_human", () => {
    const result = formatToolCallsForDryRun([
      { function: { name: "transfer_to_human", arguments: JSON.stringify({ reason: "Pediu humano" }) } },
    ]);
    expect(result[0].humanDescription).toContain("TRANSFERIR_HUMANO");
    expect(result[0].humanDescription).toContain("Pediu humano");
  });

  it("formats search_knowledge", () => {
    const result = formatToolCallsForDryRun([
      { function: { name: "search_knowledge", arguments: JSON.stringify({ query: "preco omega" }) } },
    ]);
    expect(result[0].humanDescription).toContain("BUSCAR_KB");
    expect(result[0].humanDescription).toContain("preco omega");
  });

  it("formats create_lead", () => {
    const result = formatToolCallsForDryRun([
      { function: { name: "create_lead", arguments: JSON.stringify({ name: "Joao Silva", company: "Acme" }) } },
    ]);
    expect(result[0].humanDescription).toContain("CRIAR_LEAD");
    expect(result[0].humanDescription).toContain("Joao Silva");
  });

  it("formats unknown tool with fallback JSON", () => {
    const result = formatToolCallsForDryRun([
      { function: { name: "custom_unknown_tool", arguments: JSON.stringify({ foo: "bar" }) } },
    ]);
    expect(result[0].humanDescription).toContain("custom_unknown_tool");
    expect(result[0].humanDescription).toContain("bar");
  });

  it("formats confirm_meeting", () => {
    const result = formatToolCallsForDryRun([
      { function: { name: "confirm_meeting", arguments: JSON.stringify({ confirmation_type: "confirmed" }) } },
    ]);
    expect(result[0].humanDescription).toContain("CONFIRMAR_REUNIAO");
    expect(result[0].humanDescription).toContain("confirmed");
  });

  it("formats update_lead (PREENCHER_CAMPOS)", () => {
    const result = formatToolCallsForDryRun([
      { function: { name: "update_lead", arguments: JSON.stringify({ updates: { company: "Acme", segment: "B2B" } }) } },
    ]);
    expect(result[0].humanDescription).toContain("PREENCHER_CAMPOS");
    expect(result[0].humanDescription).toContain("company");
    expect(result[0].humanDescription).toContain("Acme");
  });

  it("formats create_custom_field", () => {
    const result = formatToolCallsForDryRun([
      { function: { name: "create_custom_field", arguments: JSON.stringify({ field_name: "Orcamento", field_type: "number" }) } },
    ]);
    expect(result[0].humanDescription).toContain("CRIAR_CAMPO");
    expect(result[0].humanDescription).toContain("Orcamento");
  });
});
