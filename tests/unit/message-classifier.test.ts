/**
 * message-classifier — função pura que mapeia `whatsapp_messages.raw_payload`
 * para `{ sent_source, sent_by_ai }`.
 *
 * Bug origem (investigação Bertin 2026-05-22): 69 msgs com
 * `raw_payload.track_source='workflow-action'` salvas como `sent_source='manual'`.
 * Distorce métricas e bloqueia análises de atribuição.
 *
 * Função usada por `whatsapp-webhook/index.ts` (inbound) e
 * `history-sync-worker/index.ts` (history backfill).
 */

import { describe, it, expect } from "vitest";
import { classifyMessageSource } from "../../supabase/functions/_shared/message-classifier.ts";

describe("classifyMessageSource — track_source precedence", () => {
  it("workflow-action → workflow + AI (fix bug Bertin)", () => {
    const result = classifyMessageSource({
      raw_payload: { track_source: "workflow-action", wasSentByApi: true },
      direction: "outgoing",
      instance_context: { instance_id: "inst-1" },
    });
    expect(result).toEqual({
      sent_source: "workflow",
      sent_by_ai: true,
      track_source: "workflow-action",
    });
  });

  it("copilot → copilot + AI", () => {
    expect(
      classifyMessageSource({
        raw_payload: { track_source: "copilot" },
        direction: "outgoing",
        instance_context: { instance_id: "inst-1" },
      }),
    ).toEqual({ sent_source: "copilot", sent_by_ai: true, track_source: "copilot" });
  });

  it("mass-send → mass_send + AI", () => {
    expect(
      classifyMessageSource({
        raw_payload: { track_source: "mass-send" },
        direction: "outgoing",
        instance_context: { instance_id: "inst-1" },
      }),
    ).toEqual({ sent_source: "mass_send", sent_by_ai: true, track_source: "mass-send" });
  });
});

describe("classifyMessageSource — manual paths", () => {
  it("whatsapp-api-proxy without other hint → manual", () => {
    // Fixture real Bertin "Oi Filipe!" 12x
    expect(
      classifyMessageSource({
        raw_payload: {
          track_source: "whatsapp-api-proxy",
          source: "whatsapp-api-proxy",
          wasSentByApi: true,
          sendFunction: "sendtext",
        },
        direction: "outgoing",
        instance_context: { instance_id: "inst-1" },
      }),
    ).toMatchObject({ sent_source: "manual", sent_by_ai: false });
  });

  it("source=android (operador no celular) → manual", () => {
    expect(
      classifyMessageSource({
        raw_payload: { source: "android" },
        direction: "outgoing",
        instance_context: { instance_id: "inst-1" },
      }),
    ).toMatchObject({ sent_source: "manual", sent_by_ai: false });
  });

  it("wasSentByApi=false → manual", () => {
    expect(
      classifyMessageSource({
        raw_payload: { wasSentByApi: false },
        direction: "outgoing",
        instance_context: { instance_id: "inst-1" },
      }),
    ).toMatchObject({ sent_source: "manual", sent_by_ai: false });
  });
});

describe("classifyMessageSource — fallback", () => {
  it("empty payload → unknown (don't guess)", () => {
    expect(
      classifyMessageSource({
        raw_payload: {},
        direction: "outgoing",
        instance_context: { instance_id: "inst-1" },
      }),
    ).toEqual({ sent_source: "unknown", sent_by_ai: false, track_source: null });
  });

  it("unrecognized track_source → unknown (forward-compat — don't silently mis-classify)", () => {
    expect(
      classifyMessageSource({
        raw_payload: { track_source: "futuro-modulo-novo" },
        direction: "outgoing",
        instance_context: { instance_id: "inst-1" },
      }),
    ).toMatchObject({ sent_source: "unknown", sent_by_ai: false });
  });
});

describe("classifyMessageSource — precedence", () => {
  it("workflow-action wins over source=android (track_source mais autoritativo)", () => {
    expect(
      classifyMessageSource({
        raw_payload: { track_source: "workflow-action", source: "android" },
        direction: "outgoing",
        instance_context: { instance_id: "inst-1" },
      }),
    ).toMatchObject({ sent_source: "workflow", sent_by_ai: true });
  });

  it("copilot wins over wasSentByApi=false (track_source mais autoritativo)", () => {
    expect(
      classifyMessageSource({
        raw_payload: { track_source: "copilot", wasSentByApi: false },
        direction: "outgoing",
        instance_context: { instance_id: "inst-1" },
      }),
    ).toMatchObject({ sent_source: "copilot", sent_by_ai: true });
  });
});
