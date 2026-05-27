// @vitest-environment node
/**
 * Unit tests for conexao-comportamento-mapping.ts
 * Pure mapping functions: playground state <-> agent payload.
 * TDD: red-green-refactor.
 */

import { describe, it, expect } from "vitest";

import {
  conexaoStateToPayload,
  payloadToConexaoState,
  comportamentoStateToPayload,
  payloadToComportamentoState,
  createDefaultConexaoState,
  createDefaultComportamentoState,
  type ConexaoState,
  type ComportamentoState,
} from "../../src/modules/copilot/components/playground/conexao-comportamento-mapping";

// ──────────────────────────────────────────────
// RED-GREEN 1: Conexao state -> agent payload
// ──────────────────────────────────────────────

describe("conexaoStateToPayload", () => {
  it("maps whatsapp_instance_id from state", () => {
    const state: ConexaoState = {
      whatsappInstanceId: "inst-abc-123",
      retentionEnabled: false,
      retentionConfig: {
        max_frequency_days: 7,
        auto_approach: true,
        strategic_alert_only: false,
      },
    };
    const payload = conexaoStateToPayload(state);
    expect(payload.whatsapp_instance_id).toBe("inst-abc-123");
  });

  it("maps null when no instance selected", () => {
    const state: ConexaoState = {
      whatsappInstanceId: null,
      retentionEnabled: false,
      retentionConfig: {
        max_frequency_days: 7,
        auto_approach: true,
        strategic_alert_only: false,
      },
    };
    const payload = conexaoStateToPayload(state);
    expect(payload.whatsapp_instance_id).toBeNull();
  });

  it("maps retention_enabled and retention_config", () => {
    const state: ConexaoState = {
      whatsappInstanceId: null,
      retentionEnabled: true,
      retentionConfig: {
        max_frequency_days: 14,
        auto_approach: false,
        strategic_alert_only: true,
      },
    };
    const payload = conexaoStateToPayload(state);
    expect(payload.retention_enabled).toBe(true);
    expect(payload.retention_config).toEqual({
      max_frequency_days: 14,
      auto_approach: false,
      strategic_alert_only: true,
    });
  });

  it("clamps max_frequency_days to 3-30 range", () => {
    const state: ConexaoState = {
      whatsappInstanceId: null,
      retentionEnabled: true,
      retentionConfig: {
        max_frequency_days: 1,
        auto_approach: true,
        strategic_alert_only: false,
      },
    };
    const payload = conexaoStateToPayload(state);
    expect(payload.retention_config.max_frequency_days).toBe(3);

    state.retentionConfig.max_frequency_days = 99;
    const payload2 = conexaoStateToPayload(state);
    expect(payload2.retention_config.max_frequency_days).toBe(30);
  });
});

// ──────────────────────────────────────────────
// RED-GREEN 2: Comportamento state -> agent payload
// ──────────────────────────────────────────────

describe("comportamentoStateToPayload", () => {
  it("maps availability from state", () => {
    const state: ComportamentoState = {
      availability: {
        mode: "scheduled",
        timezone: "America/Sao_Paulo",
        days: ["mon", "tue", "wed"],
        start: "08:00",
        end: "17:00",
      },
      behaviorWindows: [],
      behaviorEnforcement: "hard",
      responseDelayMs: 2000,
      llmTemperatureMode: "preciso",
    };
    const payload = comportamentoStateToPayload(state);
    expect(payload.availability).toEqual({
      mode: "scheduled",
      timezone: "America/Sao_Paulo",
      days: ["mon", "tue", "wed"],
      start: "08:00",
      end: "17:00",
    });
  });

  it("maps behavior_windows array", () => {
    const windows = [
      {
        id: "w-1",
        name: "Comercial",
        days: ["mon", "tue"],
        start: "09:00",
        end: "18:00",
        behavior: "Atenda normalmente",
      },
    ];
    const state: ComportamentoState = {
      availability: { mode: "always", timezone: "America/Sao_Paulo", days: [], start: "09:00", end: "18:00" },
      behaviorWindows: windows,
      behaviorEnforcement: "soft",
      responseDelayMs: 5000,
      llmTemperatureMode: "criativo",
    };
    const payload = comportamentoStateToPayload(state);
    expect(payload.behavior_windows).toEqual(windows);
    expect(payload.behavior_enforcement).toBe("soft");
  });

  it("maps response_delay_ms and llm_temperature_mode", () => {
    const state: ComportamentoState = {
      availability: { mode: "always", timezone: "America/Sao_Paulo", days: [], start: "09:00", end: "18:00" },
      behaviorWindows: [],
      behaviorEnforcement: "hard",
      responseDelayMs: 3500,
      llmTemperatureMode: "balanceado",
    };
    const payload = comportamentoStateToPayload(state);
    expect(payload.response_delay_ms).toBe(3500);
    expect(payload.llm_temperature_mode).toBe("balanceado");
  });

  it("clamps response_delay_ms to 0-45000", () => {
    const state = createDefaultComportamentoState();
    state.responseDelayMs = -100;
    expect(comportamentoStateToPayload(state).response_delay_ms).toBe(0);

    state.responseDelayMs = 99000;
    expect(comportamentoStateToPayload(state).response_delay_ms).toBe(45000);
  });
});

// ──────────────────────────────────────────────
// RED-GREEN 3: Round-trip agent -> state -> agent
// ──────────────────────────────────────────────

describe("round-trip: payload -> state -> payload", () => {
  it("conexao round-trip preserves all fields", () => {
    const original = {
      whatsapp_instance_id: "inst-xyz",
      retention_enabled: true,
      retention_config: {
        max_frequency_days: 21,
        auto_approach: false,
        strategic_alert_only: true,
      },
    };
    const state = payloadToConexaoState(original);
    const result = conexaoStateToPayload(state);
    expect(result).toEqual(original);
  });

  it("conexao round-trip with null instance", () => {
    const original = {
      whatsapp_instance_id: null,
      retention_enabled: false,
      retention_config: {
        max_frequency_days: 7,
        auto_approach: true,
        strategic_alert_only: false,
      },
    };
    const state = payloadToConexaoState(original);
    const result = conexaoStateToPayload(state);
    expect(result).toEqual(original);
  });

  it("comportamento round-trip preserves all fields", () => {
    const original = {
      availability: {
        mode: "scheduled" as const,
        timezone: "America/Sao_Paulo",
        days: ["mon", "wed", "fri"],
        start: "10:00",
        end: "16:00",
      },
      behavior_windows: [
        {
          id: "w-1",
          name: "Noite",
          days: ["mon"],
          start: "18:00",
          end: "23:00",
          behavior: "Responda brevemente",
        },
      ],
      behavior_enforcement: "soft" as const,
      response_delay_ms: 1500,
      llm_temperature_mode: "criativo" as const,
    };
    const state = payloadToComportamentoState(original);
    const result = comportamentoStateToPayload(state);
    expect(result).toEqual(original);
  });

  it("payloadToConexaoState handles missing/undefined fields gracefully", () => {
    const state = payloadToConexaoState({});
    expect(state.whatsappInstanceId).toBeNull();
    expect(state.retentionEnabled).toBe(false);
    expect(state.retentionConfig.max_frequency_days).toBe(7);
  });

  it("payloadToComportamentoState handles missing/undefined fields gracefully", () => {
    const state = payloadToComportamentoState({});
    expect(state.availability.mode).toBe("always");
    expect(state.behaviorWindows).toEqual([]);
    expect(state.behaviorEnforcement).toBe("hard");
    expect(state.responseDelayMs).toBe(1000);
    expect(state.llmTemperatureMode).toBe("balanceado");
  });
});

describe("defaults", () => {
  it("createDefaultConexaoState returns sane defaults", () => {
    const d = createDefaultConexaoState();
    expect(d.whatsappInstanceId).toBeNull();
    expect(d.retentionEnabled).toBe(false);
    expect(d.retentionConfig.max_frequency_days).toBe(7);
    expect(d.retentionConfig.auto_approach).toBe(true);
    expect(d.retentionConfig.strategic_alert_only).toBe(false);
  });

  it("createDefaultComportamentoState returns sane defaults", () => {
    const d = createDefaultComportamentoState();
    expect(d.availability.mode).toBe("always");
    expect(d.behaviorEnforcement).toBe("hard");
    expect(d.responseDelayMs).toBe(1000);
    expect(d.llmTemperatureMode).toBe("balanceado");
  });
});
