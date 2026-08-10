import { assertEquals, assertNotEquals, assertMatch } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { buildMediaPath } from "./whatsapp-media.ts";

const ORG_A = "636776d8-6282-48bc-b190-764d42785a5b";
const ORG_B = "163874dd-d05c-4ae2-811a-d6772b05dac5";

const catalogo = new TextEncoder().encode("%PDF-1.4 catalogo de produtos 2026");
const outroArquivo = new TextEncoder().encode("%PDF-1.4 tabela de precos 2026");

Deno.test("mesmo conteúdo → mesmo path: é isto que colapsa as 290 cópias em 1", async () => {
  // Cópia independente do mesmo binário, como chega em dois ecos distintos.
  const copia = new TextEncoder().encode("%PDF-1.4 catalogo de produtos 2026");

  assertEquals(
    await buildMediaPath(ORG_A, catalogo, "pdf"),
    await buildMediaPath(ORG_A, copia, "pdf"),
  );
});

Deno.test("conteúdo diferente → path diferente", async () => {
  assertNotEquals(
    await buildMediaPath(ORG_A, catalogo, "pdf"),
    await buildMediaPath(ORG_A, outroArquivo, "pdf"),
  );
});

Deno.test("mesmo conteúdo em orgs diferentes → paths diferentes (isolamento multi-tenant)", async () => {
  // Compartilhar o objeto entre orgs pouparia bytes e quebraria o isolamento:
  // apagar a mídia de uma org derrubaria a da outra.
  assertNotEquals(
    await buildMediaPath(ORG_A, catalogo, "pdf"),
    await buildMediaPath(ORG_B, catalogo, "pdf"),
  );
});

Deno.test("path tem o formato esperado: whatsapp-media/<org>/<sha256>.<ext>", async () => {
  const path = await buildMediaPath(ORG_A, catalogo, "pdf");
  assertMatch(path, new RegExp(`^whatsapp-media/${ORG_A}/[0-9a-f]{64}\\.pdf$`));
});

Deno.test("um byte de diferença muda o path", async () => {
  const quaseIgual = new TextEncoder().encode("%PDF-1.4 catalogo de produtos 2027");
  assertNotEquals(
    await buildMediaPath(ORG_A, catalogo, "pdf"),
    await buildMediaPath(ORG_A, quaseIgual, "pdf"),
  );
});

Deno.test("extensão faz parte do path", async () => {
  assertNotEquals(
    await buildMediaPath(ORG_A, catalogo, "pdf"),
    await buildMediaPath(ORG_A, catalogo, "bin"),
  );
});

Deno.test("arquivo vazio não quebra", async () => {
  const path = await buildMediaPath(ORG_A, new Uint8Array(0), "jpg");
  assertMatch(path, /^whatsapp-media\/[^/]+\/[0-9a-f]{64}\.jpg$/);
});
