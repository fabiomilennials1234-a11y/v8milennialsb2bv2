import { assertEquals } from "@std/assert";
import type { CancellationCheck } from "./cancellation.ts";
import {
  buildSameTurnHandoffMarker,
  isSameTurnHandoffCancel,
  parseSameTurnHandoffMarker,
} from "./same-turn-handoff.ts";

const AT = "2026-10-13T12:00:00.123456+00:00";
const LEAD = "lead-1";

const enabled: CancellationCheck = { canceled: false, source: "phone_ai_preferences", ai_disabled: false, systemDisabled: false };
const handoff: CancellationCheck = {
  canceled: true, source: "phone_ai_preferences", ai_disabled: true, systemDisabled: true, disabledAt: AT, humanPauseActive: false,
};

Deno.test("build — IA ligada antes e desligada depois com carimbo → marcador", () => {
  assertEquals(buildSameTurnHandoffMarker(LEAD, enabled, handoff), { lead_id: LEAD, disabled_at: AT });
  const viaLeads: CancellationCheck = { ...handoff, source: "leads" };
  assertEquals(buildSameTurnHandoffMarker(LEAD, { ...enabled, source: "default" }, viaLeads), { lead_id: LEAD, disabled_at: AT });
});

Deno.test("build — IA já desligada/pausada antes, gate com erro, ou sem carimbo → null", () => {
  assertEquals(buildSameTurnHandoffMarker(LEAD, handoff, handoff), null);
  assertEquals(buildSameTurnHandoffMarker(LEAD, { ...enabled, canceled: true, source: "human_pause" }, handoff), null);
  assertEquals(buildSameTurnHandoffMarker(LEAD, { ...enabled, source: "error" }, handoff), null);
  assertEquals(buildSameTurnHandoffMarker(LEAD, enabled, { ...handoff, disabledAt: null }), null);
  assertEquals(buildSameTurnHandoffMarker(LEAD, enabled, { ...handoff, disabledAt: "lixo" }), null);
  assertEquals(buildSameTurnHandoffMarker(LEAD, enabled, { ...handoff, humanPauseActive: true }), null);
  assertEquals(buildSameTurnHandoffMarker(LEAD, enabled, enabled), null);
  assertEquals(buildSameTurnHandoffMarker("", enabled, handoff), null);
});

Deno.test("parse — só objeto com lead_id e disabled_at datável", () => {
  assertEquals(parseSameTurnHandoffMarker({ lead_id: LEAD, disabled_at: AT }), { lead_id: LEAD, disabled_at: AT });
  for (const bad of [null, undefined, true, "x", [], [{ lead_id: LEAD, disabled_at: AT }], { lead_id: LEAD }, { lead_id: "", disabled_at: AT }, { lead_id: LEAD, disabled_at: "x" }]) {
    assertEquals(parseSameTurnHandoffMarker(bad), null);
  }
});

Deno.test("isSameTurnHandoffCancel — libera só o desligamento idêntico do mesmo lead", () => {
  const marker = { lead_id: LEAD, disabled_at: AT };
  assertEquals(isSameTurnHandoffCancel(handoff, marker, LEAD), true);
  // mesmo instante em outra representação textual
  assertEquals(isSameTurnHandoffCancel({ ...handoff, disabledAt: "2026-10-13T12:00:00.123Z" }, marker, LEAD), true);
  assertEquals(isSameTurnHandoffCancel({ ...handoff, disabledAt: "2026-10-13T12:00:01Z" }, marker, LEAD), false);
  assertEquals(isSameTurnHandoffCancel(handoff, { ...marker, lead_id: "outro" }, LEAD), false);
  assertEquals(isSameTurnHandoffCancel(handoff, marker, null), false);
  assertEquals(isSameTurnHandoffCancel(handoff, undefined, LEAD), false);
  assertEquals(isSameTurnHandoffCancel({ ...handoff, humanPauseActive: true }, marker, LEAD), false);
  assertEquals(isSameTurnHandoffCancel({ ...handoff, source: "human_pause", ai_disabled: false }, marker, LEAD), false);
  assertEquals(isSameTurnHandoffCancel({ ...handoff, source: "error" }, marker, LEAD), false);
  assertEquals(isSameTurnHandoffCancel({ ...handoff, disabledAt: undefined }, marker, LEAD), false);
  assertEquals(isSameTurnHandoffCancel(enabled, marker, LEAD), false);
});
