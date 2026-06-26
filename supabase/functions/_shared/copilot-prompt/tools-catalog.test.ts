import { assertEquals } from "@std/assert";
import { CATALOG_BY_ID, TOOLS_CATALOG } from "./tools-catalog.ts";

Deno.test("catalog has the 10 playground tools in order", () => {
  assertEquals(TOOLS_CATALOG.map((t) => t.id), [
    "QUALIFICAR_LEAD",
    "AGENDAR_REUNIAO",
    "MOVER_CARD",
    "TRANSFERIR_HUMANO",
    "CRIAR_LEAD",
    "PREENCHER_CAMPOS",
    "TRANSFERIR_SZ_CHAT",
    "ENVIAR_DOCUMENTO",
    "CRIAR_CAMPO",
    "PAUSAR_ATENDIMENTO_HUMANO",
  ]);
});

Deno.test("every tool has non-empty name + defaultInstruction", () => {
  for (const t of TOOLS_CATALOG) {
    if (!t.name.trim() || !t.defaultInstruction.trim()) throw new Error(`empty ${t.id}`);
  }
});

Deno.test("CATALOG_BY_ID indexes all", () => assertEquals(Object.keys(CATALOG_BY_ID).length, 10));
