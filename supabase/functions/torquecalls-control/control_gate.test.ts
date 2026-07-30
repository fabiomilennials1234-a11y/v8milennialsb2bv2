import { assertEquals } from "jsr:@std/assert";
import { resolveSessionCap, voiceFeatureOn } from "./index.ts";

Deno.test("teto vem da organização, não de constante", () => {
  assertEquals(resolveSessionCap({ voice_sessions_cap: 3 }), 3);
});

Deno.test("teto 0 significa nenhum número de voz", () => {
  assertEquals(resolveSessionCap({ voice_sessions_cap: 0 }), 0);
});

Deno.test("organização sem linha cai no padrão 10", () => {
  assertEquals(resolveSessionCap(null), 10);
});

Deno.test("feature ausente no plano é desligada, não liberada", () => {
  assertEquals(voiceFeatureOn({}), false);
  assertEquals(voiceFeatureOn({ voice_calls: false }), false);
  assertEquals(voiceFeatureOn({ voice_calls: true }), true);
});
