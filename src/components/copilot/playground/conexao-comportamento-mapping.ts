/**
 * Pure mapping functions for Conexao & Comportamento tabs.
 *
 * No React deps -- testable in Node vitest.
 * Follows same pattern as funis-mapping.ts.
 */

import type { BehaviorEnforcement, BehaviorWindow } from "@/components/copilot/BehaviorWindowsEditor";

// ── Conexao State ──

export interface RetentionConfig {
  max_frequency_days: number;
  auto_approach: boolean;
  strategic_alert_only: boolean;
}

export interface ConexaoState {
  whatsappInstanceId: string | null;
  retentionEnabled: boolean;
  retentionConfig: RetentionConfig;
}

// ── Conexao Payload (DB shape) ──

export interface ConexaoPayload {
  whatsapp_instance_id: string | null;
  retention_enabled: boolean;
  retention_config: RetentionConfig;
}

// ── Comportamento State ──

export interface AvailabilityState {
  mode: "always" | "scheduled";
  timezone: string;
  days: string[];
  start: string;
  end: string;
}

export interface ComportamentoState {
  availability: AvailabilityState;
  behaviorWindows: BehaviorWindow[];
  behaviorEnforcement: BehaviorEnforcement;
  responseDelayMs: number;
  llmTemperatureMode: "criativo" | "balanceado" | "preciso";
}

// ── Comportamento Payload (DB shape) ──

export interface ComportamentoPayload {
  availability: AvailabilityState;
  behavior_windows: BehaviorWindow[];
  behavior_enforcement: BehaviorEnforcement;
  response_delay_ms: number;
  llm_temperature_mode: "criativo" | "balanceado" | "preciso";
}

// ── Helpers ──

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ── Defaults ──

export function createDefaultConexaoState(): ConexaoState {
  return {
    whatsappInstanceId: null,
    retentionEnabled: false,
    retentionConfig: {
      max_frequency_days: 7,
      auto_approach: true,
      strategic_alert_only: false,
    },
  };
}

export function createDefaultComportamentoState(): ComportamentoState {
  return {
    availability: {
      mode: "always",
      timezone: "America/Sao_Paulo",
      days: ["mon", "tue", "wed", "thu", "fri"],
      start: "09:00",
      end: "18:00",
    },
    behaviorWindows: [],
    behaviorEnforcement: "hard",
    responseDelayMs: 1000,
    llmTemperatureMode: "balanceado",
  };
}

// ── Conexao Mappers ──

export function conexaoStateToPayload(state: ConexaoState): ConexaoPayload {
  return {
    whatsapp_instance_id: state.whatsappInstanceId,
    retention_enabled: state.retentionEnabled,
    retention_config: {
      max_frequency_days: clamp(state.retentionConfig.max_frequency_days, 3, 30),
      auto_approach: state.retentionConfig.auto_approach,
      strategic_alert_only: state.retentionConfig.strategic_alert_only,
    },
  };
}

export function payloadToConexaoState(agent: Record<string, any>): ConexaoState {
  const rc = agent.retention_config || {};
  return {
    whatsappInstanceId: agent.whatsapp_instance_id ?? null,
    retentionEnabled: agent.retention_enabled ?? false,
    retentionConfig: {
      max_frequency_days: rc.max_frequency_days ?? 7,
      auto_approach: rc.auto_approach ?? true,
      strategic_alert_only: rc.strategic_alert_only ?? false,
    },
  };
}

// ── Comportamento Mappers ──

export function comportamentoStateToPayload(state: ComportamentoState): ComportamentoPayload {
  return {
    availability: { ...state.availability },
    behavior_windows: state.behaviorWindows,
    behavior_enforcement: state.behaviorEnforcement,
    response_delay_ms: clamp(state.responseDelayMs, 0, 45000),
    llm_temperature_mode: state.llmTemperatureMode,
  };
}

export function payloadToComportamentoState(agent: Record<string, any>): ComportamentoState {
  const defaults = createDefaultComportamentoState();
  return {
    availability: agent.availability ?? { ...defaults.availability },
    behaviorWindows: Array.isArray(agent.behavior_windows) ? agent.behavior_windows : [],
    behaviorEnforcement: agent.behavior_enforcement === "soft" ? "soft" : "hard",
    responseDelayMs: agent.response_delay_ms ?? 1000,
    llmTemperatureMode: agent.llm_temperature_mode ?? "balanceado",
  };
}
