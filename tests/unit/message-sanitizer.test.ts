import { describe, it, expect } from "vitest";
import {
  sanitizeAssistantMessage,
  splitByDelimiter,
} from "../../supabase/functions/_shared/message-sanitizer";

describe("sanitizeAssistantMessage", () => {
  it("passes through clean text untouched", () => {
    const r = sanitizeAssistantMessage("Oi Thais, tudo bem?", false);
    expect(r.text).toBe("Oi Thais, tudo bem?");
    expect(r.droppedBlocks).toBe(0);
    expect(r.recoveredAction).toBeNull();
  });

  it("strips raw ReAct JSON leaked as text (incidente Barulhinho Bom)", () => {
    const raw = [
      "Com certeza! Vou te mandar a foto e o vídeo.",
      "",
      '{ "action": "send_media", "action_input": "{ \\"media_id\\": \\"banana verde.jpeg\\" }" }',
      "",
      '{ "action": "send_media", "action_input": "{ \\"media_id\\": \\"Video banana verde.mp4\\" }" }',
    ].join("\n");

    const r = sanitizeAssistantMessage(raw, false);
    expect(r.text).toBe("Com certeza! Vou te mandar a foto e o vídeo.");
    expect(r.droppedBlocks).toBe(2);
    // send_media não é tool real → não recupera
    expect(r.recoveredAction).toBeNull();
  });

  it("strips fenced JSON ```json ... ```", () => {
    const raw =
      "Claro, segue o material.\n\n```json\n{\"action\":\"send_product_material\",\"action_input\":{\"material_id\":\"abc-123\"}}\n```";
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.text).toBe("Claro, segue o material.");
    expect(r.droppedBlocks).toBe(1);
  });

  it("strips inline <tool_name: args> pseudo-tags leaked as text (Barulhinho Bom 2026-06-02)", () => {
    const raw = [
      "Vou te encaminhar agora para o consultor que ele já te passa a tabela de preços junto com os vídeos, pode ser?",
      "",
      "<send_video: Linha de produtos.mp4>",
      '<qualify_lead: {"nome": "gabriel", "empresa": "Mtech", "segmento": "mercadinho", "cidade": "não informada", "linha_interesse": "batata doce e mix nuts", "volume_estimado": "não informado"}>',
      '<move_card: "Qualificado">',
      '<transfer_to_human: "Lead Gabriel do mercadinho quer saber preços e ver vídeos da linha. Já sabe do pedido mínimo de R$ 300.">',
    ].join("\n");

    const r = sanitizeAssistantMessage(raw, false);
    expect(r.text).toBe(
      "Vou te encaminhar agora para o consultor que ele já te passa a tabela de preços junto com os vídeos, pode ser?",
    );
    // Nenhuma tag de tool pode sobrar no texto que vai pro cliente.
    expect(r.text).not.toContain("<");
    expect(r.droppedBlocks).toBe(4);
    // qualify_lead tem args JSON e mapeia → recupera a ação.
    expect(r.recoveredAction?.action).toBe("QUALIFY_LEAD");
    expect((r.recoveredAction?.params as Record<string, unknown>)?.empresa).toBe("Mtech");
  });

  it("does NOT strip legitimate text with a non-tool <word: value> shape", () => {
    const raw = "Horário de atendimento <segunda: 9h às 18h>, pode contar comigo!";
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.text).toBe(raw);
    expect(r.droppedBlocks).toBe(0);
  });

  it("recovers mapped tool as action when tool_call was missed", () => {
    const raw =
      'Vou enviar o catálogo.\n{ "action": "send_product_material", "action_input": "{\\"material_id\\":\\"mat-1\\"}" }';
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.text).toBe("Vou enviar o catálogo.");
    expect(r.droppedBlocks).toBe(1);
    expect(r.recoveredAction).toEqual({
      action: "SEND_PRODUCT_MATERIAL",
      params: { material_id: "mat-1" },
    });
  });

  it("accepts action_input as object (not only string)", () => {
    const raw =
      'Agendando.\n{ "action": "schedule_meeting", "action_input": { "preferred_date": "2026-05-01" } }';
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.recoveredAction).toEqual({
      action: "SCHEDULE_MEETING",
      params: { preferred_date: "2026-05-01" },
    });
  });

  it("does not recover when tool_call already came from native tool_calls", () => {
    const raw =
      'Ok.\n{ "action": "schedule_meeting", "action_input": { "preferred_date": "2026-05-01" } }';
    const r = sanitizeAssistantMessage(raw, true);
    expect(r.droppedBlocks).toBe(1);
    expect(r.recoveredAction).toBeNull();
  });

  it("handles empty / null input safely", () => {
    expect(sanitizeAssistantMessage("", false).text).toBe("");
    expect(sanitizeAssistantMessage(null as unknown as string, false).text).toBe(null);
  });

  it("collapses triple newlines left by stripping", () => {
    const raw = 'Topo\n\n\n{"action":"x_unknown"}\n\n\nFim';
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.text).toBe("Topo\n\nFim");
  });

  it("kills residual line-form action JSON the main regex misses", () => {
    const raw = 'Mensagem\n{"action":"send_product_material","action_input":"incomplete';
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.text).not.toMatch(/"action"/);
  });

  // ============================================================
  // Regressão: leak <tool_call> XML (Barulinho Bom 2026-05-21)
  // gemini-3-flash-preview emite tool calls como TEXTO no formato
  // universal-tool-calling (Hermes/Qwen) em vez de native tool_calls.
  // ============================================================

  it("strips <tool_call> XML blocks with tool_name/tool_arguments schema", () => {
    const raw = [
      "Como sua loja é de produtos naturais, você pretende focar mais nos pacotinhos ou granel?",
      "",
      "<tool_call>",
      '{"tool_name": "send_product_material", "tool_arguments": {"material_id": "e5e84c2d-ac9e-4dc2-8349-02f6893f6f1e"}}',
      "</tool_call>",
      "<tool_call>",
      '{"tool_name": "send_product_material", "tool_arguments": {"material_id": "060d4750-7f23-45f8-84be-977469ec1101"}}',
      "</tool_call>",
    ].join("\n");

    const r = sanitizeAssistantMessage(raw, false);
    expect(r.text).toBe(
      "Como sua loja é de produtos naturais, você pretende focar mais nos pacotinhos ou granel?",
    );
    expect(r.text).not.toMatch(/tool_call/i);
    expect(r.text).not.toMatch(/tool_name/i);
    expect(r.droppedBlocks).toBeGreaterThanOrEqual(2);
  });

  it("recovers action from <tool_call> with tool_name/tool_arguments when native tool missed", () => {
    const raw = [
      "Segue o material.",
      "<tool_call>",
      '{"tool_name": "send_product_material", "tool_arguments": {"material_id": "mat-xyz"}}',
      "</tool_call>",
    ].join("\n");
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.text).toBe("Segue o material.");
    expect(r.recoveredAction).toEqual({
      action: "SEND_PRODUCT_MATERIAL",
      params: { material_id: "mat-xyz" },
    });
  });

  it("supports legacy <tool_call> schema name/arguments (OpenRouter universal)", () => {
    const raw = [
      "Buscando.",
      "<tool_call>",
      '{"name": "search_knowledge", "arguments": {"query": "chips embalagem"}}',
      "</tool_call>",
    ].join("\n");
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.text).toBe("Buscando.");
    expect(r.text).not.toMatch(/tool_call/i);
    expect(r.droppedBlocks).toBeGreaterThanOrEqual(1);
  });

  it("strips <vertical_tool_calls> wrapper variant", () => {
    const raw = [
      "Olha só.",
      "<vertical_tool_calls>",
      '<tool_call name="search_knowledge" arguments=\'{"query":"x"}\'>',
      "</tool_call>",
      "</vertical_tool_calls>",
    ].join("\n");
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.text).toBe("Olha só.");
    expect(r.text).not.toMatch(/tool_call|vertical/i);
  });

  it("strips standalone <no_tool_calls> sentinel", () => {
    const raw = "Ok, sem ação agora.\n<no_tool_calls>";
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.text).toBe("Ok, sem ação agora.");
    expect(r.text).not.toMatch(/no_tool_calls/i);
  });

  it("self-closing <no_tool_calls /> also stripped", () => {
    const raw = "Tudo certo.\n<no_tool_calls />";
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.text).toBe("Tudo certo.");
  });

  it("handles unclosed <tool_call> defensively (discards trailing leak)", () => {
    const raw = "Vou enviar.\n<tool_call>\n{\"tool_name\": \"send_product_material\", \"tool_arguments\":";
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.text).toBe("Vou enviar.");
    expect(r.text).not.toMatch(/tool_call|tool_name/i);
  });

  it("does not recover from <tool_call> when alreadyHasAction (native fired)", () => {
    const raw = [
      "Ok.",
      "<tool_call>",
      '{"tool_name": "send_product_material", "tool_arguments": {"material_id": "m1"}}',
      "</tool_call>",
    ].join("\n");
    const r = sanitizeAssistantMessage(raw, true);
    expect(r.text).toBe("Ok.");
    expect(r.recoveredAction).toBeNull();
    expect(r.droppedBlocks).toBeGreaterThanOrEqual(1);
  });

  it("ignores <tool_call> with unknown tool name (no recovery, still strips)", () => {
    const raw = [
      "Hmm.",
      "<tool_call>",
      '{"tool_name": "made_up_tool", "tool_arguments": {}}',
      "</tool_call>",
    ].join("\n");
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.text).toBe("Hmm.");
    expect(r.recoveredAction).toBeNull();
    expect(r.droppedBlocks).toBeGreaterThanOrEqual(1);
  });

  it("strips case-insensitive <TOOL_CALL> / <Tool_Call>", () => {
    const raw = "Texto.\n<TOOL_CALL>\n{}\n</TOOL_CALL>\n<Tool_Call>\n{}\n</Tool_Call>";
    const r = sanitizeAssistantMessage(raw, false);
    expect(r.text).toBe("Texto.");
  });
});

describe("splitByDelimiter", () => {
  it("splits on canonical ||SPLIT||", () => {
    expect(splitByDelimiter("a ||SPLIT|| b ||SPLIT|| c")).toEqual(["a", "b", "c"]);
  });

  it("splits on lowercase ||split|| (case tolerant)", () => {
    expect(splitByDelimiter("a ||split|| b")).toEqual(["a", "b"]);
  });

  it("tolerates whitespace variation || SPLIT ||", () => {
    expect(splitByDelimiter("a || SPLIT || b")).toEqual(["a", "b"]);
  });

  it("returns single-element array when no delimiter", () => {
    expect(splitByDelimiter("just text")).toEqual(["just text"]);
  });

  it("drops empty chunks", () => {
    expect(splitByDelimiter("||SPLIT||a||SPLIT||")).toEqual(["a"]);
  });
});
