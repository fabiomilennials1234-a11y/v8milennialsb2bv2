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
