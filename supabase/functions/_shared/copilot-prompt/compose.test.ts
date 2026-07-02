import { assertEquals, assertStringIncludes } from "@std/assert";
import { type ComposeInput, composeSystemPrompt } from "./compose.ts";
import goldens from "./fixtures/compose-goldens.json" with { type: "json" };

const base: ComposeInput = {
  promptSections: {
    personality: "Voce e a Ana.",
    objective: "Qualificar.",
    flow: "1. Saudar",
    products: "",
    instructions: "Nunca minta.",
  },
  tools: [],
  documents: [],
  links: [],
};

Deno.test("compose: ordem e headers dos sections", () => {
  const out = composeSystemPrompt(base);
  assertEquals(
    out,
    "# PERSONALIDADE\n\nVoce e a Ana.\n\n" +
      "# OBJETIVO\n\nQualificar.\n\n" +
      "# FLUXO DE ATENDIMENTO\n\n1. Saudar\n\n" +
      "# INSTRUÇÕES\n\nNunca minta.",
  );
});

Deno.test("compose: section vazia é omitida", () => {
  const out = composeSystemPrompt({
    ...base,
    promptSections: { ...base.promptSections, objective: "  " },
  });
  assertEquals(out.includes("# OBJETIVO"), false);
});

Deno.test("compose: products entra antes de ferramentas", () => {
  const out = composeSystemPrompt({
    ...base,
    promptSections: { ...base.promptSections, products: "Plano X" },
  });
  assertStringIncludes(out, "# PRODUTOS E SERVICOS\n\nPlano X");
});

Deno.test("compose: tool enabled vira bloco com instrução custom; default quando vazia", () => {
  const out = composeSystemPrompt({
    ...base,
    tools: [
      { id: "QUALIFICAR_LEAD", enabled: true, instruction: "" },
      { id: "AGENDAR_REUNIAO", enabled: true, instruction: "Use o link X" },
    ],
  });
  assertStringIncludes(out, "# FERRAMENTAS DISPONÍVEIS");
  assertStringIncludes(out, "## Qualificar Lead\nConforme o lead compartilha");
  assertStringIncludes(out, "## Agendar Reuniao\nUse o link X");
});

Deno.test("compose: tool disabled não entra", () => {
  const out = composeSystemPrompt({
    ...base,
    tools: [{ id: "QUALIFICAR_LEAD", enabled: false, instruction: "" }],
  });
  assertEquals(out.includes("# FERRAMENTAS"), false);
});

Deno.test("compose: mídia (image/video com desc ou sendWhen) entra; document não", () => {
  const out = composeSystemPrompt({
    ...base,
    documents: [
      { id: "d1", name: "Catalogo.png", fileType: "image", description: "catalogo", sendWhen: "" },
      { id: "d2", name: "Manual.pdf", fileType: "document", description: "x" },
    ],
  });
  assertStringIncludes(out, "# MÍDIA DISPONÍVEL PARA ENVIAR");
  assertStringIncludes(out, "## [imagem] Catalogo.png\nDescricao: catalogo");
  assertEquals(out.includes("Manual.pdf"), false);
});

Deno.test("compose: @mention de tool enabled vira instrução", () => {
  const out = composeSystemPrompt({
    ...base,
    promptSections: { ...base.promptSections, flow: "Faca @QUALIFICAR_LEAD agora" },
    tools: [{ id: "QUALIFICAR_LEAD", enabled: true, instruction: "" }],
  });
  assertStringIncludes(out, 'Faca [usar ferramenta "Qualificar Lead"] agora');
});

Deno.test("compose: @mention de tool disabled vira nome plano", () => {
  const out = composeSystemPrompt({
    ...base,
    promptSections: { ...base.promptSections, flow: "Use @QUALIFICAR_LEAD se precisar" },
    tools: [{ id: "QUALIFICAR_LEAD", enabled: false, instruction: "" }],
  });
  assertStringIncludes(out, "Use Qualificar Lead se precisar");
});

Deno.test("compose: @link mention resolve para alias e url", () => {
  const out = composeSystemPrompt({
    ...base,
    promptSections: { ...base.promptSections, flow: "Acesse @link-abc" },
    links: [{ id: "link-abc", alias: "Site", url: "https://exemplo.com" }],
  });
  assertStringIncludes(out, "Acesse Site (https://exemplo.com)");
});

Deno.test("compose: @doc mention resolve para nome do documento", () => {
  const out = composeSystemPrompt({
    ...base,
    promptSections: { ...base.promptSections, instructions: "Veja @doc-xyz" },
    documents: [{ id: "doc-xyz", name: "Catalogo.pdf", fileType: "document" }],
  });
  assertStringIncludes(out, "Veja [documento: Catalogo.pdf]");
});

Deno.test("compose: links section usa ## e inclui aviso", () => {
  const out = composeSystemPrompt({
    ...base,
    links: [{ id: "l1", alias: "Loja", url: "https://loja.com" }],
  });
  assertStringIncludes(
    out,
    "## Links disponiveis para enviar ao lead:\n- Loja: https://loja.com\n",
  );
  assertStringIncludes(out, "IMPORTANTE: Quando relevante, envie o link completo");
});

Deno.test("compose: golden fixtures (parity contract)", () => {
  for (const g of goldens as Array<{ name: string; input: ComposeInput; expected: string }>) {
    assertEquals(composeSystemPrompt(g.input), g.expected, `golden mismatch: ${g.name}`);
  }
});
