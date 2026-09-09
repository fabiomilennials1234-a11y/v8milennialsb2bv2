// @vitest-environment node
/**
 * Os escopos que a tela oferece são os que o backend reconhece.
 *
 * `ApiKeysPanel.tsx` carrega a lista de escopos com o comentário "Mirrors
 * API_SCOPES" — e tinha parado de espelhar: quando o ADR-0030 criou `deal:read`
 * e `deal:write`, só o backend foi atualizado. O efeito era mudo e caro: a tela
 * emitia chave sem escopo de Negócio, e as rotas `/api/v1/deals` (que estão em
 * produção) respondiam 403 para uma chave que o cliente acabara de criar.
 *
 * Espelho mantido por comentário é espelho que quebra. Este teste lê os dois
 * arquivos e compara.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

/** `API_SCOPES` de supabase/functions/_shared/api/scopes.ts — a verdade. */
function escoposDoBackend(): string[] {
  const src = read("supabase/functions/_shared/api/scopes.ts");
  const bloco = /export const API_SCOPES = \[([\s\S]*?)\] as const;/.exec(src);
  if (!bloco) throw new Error("API_SCOPES não encontrado em scopes.ts");
  return [...bloco[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/** `AVAILABLE_SCOPES` de ApiKeysPanel.tsx — o que o cliente consegue marcar. */
function escoposDaTela(): string[] {
  const src = read("src/modules/platform/components/settings/ApiKeysPanel.tsx");
  const bloco = /const AVAILABLE_SCOPES = \[([\s\S]*?)\n\];/.exec(src);
  if (!bloco) throw new Error("AVAILABLE_SCOPES não encontrado em ApiKeysPanel.tsx");
  return [...bloco[1].matchAll(/value:\s*"([^"]+)"/g)].map((m) => m[1]);
}

describe("escopos de API — tela e backend concordam", () => {
  it("todo escopo que a tela oferece é reconhecido pelo backend", () => {
    const backend = new Set(escoposDoBackend());
    const inventados = escoposDaTela().filter((s) => !backend.has(s));
    expect(inventados, "a tela oferece escopo que o backend não conhece").toEqual([]);
  });

  it("a tela oferece os escopos de Negócio — as rotas de deals estão em produção", () => {
    const tela = escoposDaTela();
    expect(tela).toContain("deal:read");
    expect(tela).toContain("deal:write");
  });

  it("a tela oferece TODOS os escopos do backend — nenhum fica sem caixa para marcar", () => {
    // A direção que faltava. O teste original só barrava escopo inventado na
    // tela; escopo novo no backend passava despercebido, e o cliente ficava sem
    // como conceder uma permissão que existe — foi o que aconteceu com
    // `deal:write`, e o sintoma foi 403 no Make.
    const tela = new Set(escoposDaTela());
    const ausentes = escoposDoBackend().filter((s) => !tela.has(s));
    expect(ausentes, "escopo existe no backend e a tela não deixa marcar").toEqual([]);
  });

  it("controle: os dois lados foram lidos de verdade", () => {
    expect(escoposDoBackend().length).toBeGreaterThan(5);
    expect(escoposDaTela().length).toBeGreaterThan(5);
  });
});
