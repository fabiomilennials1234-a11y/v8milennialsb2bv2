import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { oraculoCommercialMode } from "./mode.ts";

Deno.test("oraculo-comercial — mantém somente análise da TV", () => {
  assertEquals(oraculoCommercialMode({ mode: "tv_analysis" }), "tv_analysis");
  assertEquals(oraculoCommercialMode({ mode: "chat" }), null);
  assertEquals(oraculoCommercialMode({ metrics: { faturamento: 100 } }), null);
  assertEquals(oraculoCommercialMode(null), null);
});
