/**
 * Tests for copilot dead code removal (issue #237)
 *
 * RED-GREEN 1: PlaygroundSettings does NOT render proactive agent fields
 * RED-GREEN 2: New agents default to operation_mode='inbound' and template_type='custom'
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// -------------------------------------------------------
// RED-GREEN 1: Proactive agent UI removed from PlaygroundSettings
// -------------------------------------------------------
describe("PlaygroundSettings dead code removal", () => {
  const settingsSource = readFileSync(
    resolve(__dirname, "../../src/components/copilot/playground/PlaygroundSettings.tsx"),
    "utf-8"
  );

  it("does NOT contain Agente Proativo section", () => {
    expect(settingsSource).not.toContain("Agente Proativo");
  });

  it("does NOT contain operation mode selector UI", () => {
    expect(settingsSource).not.toContain("operationMode");
    expect(settingsSource).not.toContain("Modo de operacao");
  });

  it("does NOT contain activation triggers UI", () => {
    expect(settingsSource).not.toContain("activationTriggers");
    expect(settingsSource).not.toContain("Gatilhos de ativacao");
    expect(settingsSource).not.toContain("TRIGGER_OPTIONS");
  });

  it("does NOT contain outbound config UI", () => {
    expect(settingsSource).not.toContain("outboundConfig");
    expect(settingsSource).not.toContain("Configuracao de disparo");
    expect(settingsSource).not.toContain("firstMessageTemplate");
  });

  it("does NOT contain audio send config", () => {
    expect(settingsSource).not.toContain("audioEnabled");
    expect(settingsSource).not.toContain("audioSendOrder");
  });

  it("does NOT import unused icons/components for proactive section", () => {
    expect(settingsSource).not.toContain("Radio");
    expect(settingsSource).not.toContain("Mic");
    expect(settingsSource).not.toContain("Checkbox");
    expect(settingsSource).not.toContain("Textarea");
  });
});

// -------------------------------------------------------
// RED-GREEN 2: Default values for new agents
// -------------------------------------------------------
describe("playgroundToAgentPayload defaults", () => {
  const playgroundSource = readFileSync(
    resolve(__dirname, "../../src/components/copilot/playground/CopilotPlayground.tsx"),
    "utf-8"
  );

  it("defaults operation_mode to 'inbound' in payload", () => {
    // The payload builder should hardcode inbound, not read from data.operationMode
    expect(playgroundSource).toContain('operation_mode: "inbound"');
  });

  it("defaults template_type to 'custom' in payload", () => {
    expect(playgroundSource).toContain('template_type: data.templateType || "custom"');
  });

  it("does NOT contain template selector dropdown in header", () => {
    // Template preset dropdown should be removed from the header
    expect(playgroundSource).not.toMatch(/SelectTrigger.*template/i);
    expect(playgroundSource).not.toContain("Selecione template");
    expect(playgroundSource).not.toContain("TEMPLATE_PRESETS.map");
  });
});
