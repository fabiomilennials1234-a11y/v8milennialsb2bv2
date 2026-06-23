/**
 * resolveRecoveredMedia — resolve um filename de mídia vazado (capturado pelo
 * sanitizer como recoveredMediaByName) para uma ação SEND_DOCUMENT real,
 * buscando o document_id em copilot_agent_documents (agent_id, status='ready').
 *
 * Incidente KomBag 2026-06-23: o copilot vazou uma tag-de-chamada referenciando
 * `Tamanhos.jpeg` em vez de chamar o tool nativo send_document. O sanitizer
 * (puro) só extrai o filename; a resolução para document_id acontece aqui.
 *
 * Match: exato (case-insensitive) primeiro, depois ilike (parcial). Se não
 * achar doc ready → null (engine apenas suprime, comportamento atual).
 */

import { describe, it, expect } from "vitest";
import { resolveRecoveredMedia } from "../../supabase/functions/agent-message/engine/decide-action.ts";

type Doc = { id: string; file_name: string };

/**
 * Mock mínimo do supabase client cobrindo o shape usado por resolveRecoveredMedia:
 *   from("copilot_agent_documents").select("id, file_name")
 *     .eq("agent_id", x).eq("organization_id", y).eq("status", "ready")
 *     .ilike("file_name", pattern).limit(n)
 * Resolve com os docs cujo file_name casa o filtro ilike (case-insensitive).
 */
function makeSupabase(docs: Doc[]) {
  return {
    from(table: string) {
      const filters: { ilike?: { col: string; pattern: string } } = {};
      const chain: Record<string, any> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.ilike = (col: string, pattern: string) => {
        filters.ilike = { col, pattern };
        return chain;
      };
      chain.limit = () => chain;
      chain.then = (resolve: any, reject?: any) => {
        if (table !== "copilot_agent_documents") {
          return Promise.resolve({ data: [], error: null }).then(resolve, reject);
        }
        let data = docs;
        if (filters.ilike) {
          // Traduz o pattern ilike (`%`, case-insensitive) para um teste local.
          const raw = filters.ilike.pattern;
          const isWildcard = raw.includes("%");
          const needle = raw.replace(/%/g, "").toLowerCase();
          data = docs.filter((d) =>
            isWildcard
              ? d.file_name.toLowerCase().includes(needle)
              : d.file_name.toLowerCase() === needle,
          );
        }
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      };
      return chain;
    },
  };
}

describe("resolveRecoveredMedia", () => {
  it("resolves an exact case-insensitive filename match to SEND_DOCUMENT", async () => {
    const sb = makeSupabase([
      { id: "622d085b-0000-4000-8000-000000000000", file_name: "Tamanhos.jpeg" },
      { id: "doc-other", file_name: "Catalogo.pdf" },
    ]) as any;
    const result = await resolveRecoveredMedia(sb, "agent-1", "org-1", "tamanhos.jpeg");
    expect(result).toEqual({
      action: "SEND_DOCUMENT",
      params: { document_id: "622d085b-0000-4000-8000-000000000000" },
      tenant_id: "org-1",
    });
  });

  it("falls back to ilike partial match (doc name contains the leaked name)", async () => {
    const sb = makeSupabase([
      { id: "doc-1", file_name: "Catalogo Tamanhos.jpeg (versão 2026)" },
    ]) as any;
    const result = await resolveRecoveredMedia(sb, "agent-1", "org-1", "Tamanhos.jpeg");
    expect(result).toEqual({
      action: "SEND_DOCUMENT",
      params: { document_id: "doc-1" },
      tenant_id: "org-1",
    });
  });

  it("returns null when no ready document matches (engine suppresses, no action)", async () => {
    const sb = makeSupabase([{ id: "doc-1", file_name: "Catalogo.pdf" }]) as any;
    const result = await resolveRecoveredMedia(sb, "agent-1", "org-1", "Tamanhos.jpeg");
    expect(result).toBeNull();
  });

  it("returns null for empty / missing filename", async () => {
    const sb = makeSupabase([{ id: "doc-1", file_name: "Tamanhos.jpeg" }]) as any;
    expect(await resolveRecoveredMedia(sb, "agent-1", "org-1", "")).toBeNull();
    expect(await resolveRecoveredMedia(sb, "agent-1", "org-1", "   ")).toBeNull();
  });

  it("returns null when agentId is missing (cannot scope lookup safely)", async () => {
    const sb = makeSupabase([{ id: "doc-1", file_name: "Tamanhos.jpeg" }]) as any;
    expect(await resolveRecoveredMedia(sb, null, "org-1", "Tamanhos.jpeg")).toBeNull();
  });

  it("prefers exact match over partial when both exist", async () => {
    const sb = makeSupabase([
      { id: "doc-partial", file_name: "Tamanhos GRANDES.jpeg" },
      { id: "doc-exact", file_name: "Tamanhos.jpeg" },
    ]) as any;
    const result = await resolveRecoveredMedia(sb, "agent-1", "org-1", "Tamanhos.jpeg");
    expect(result?.params).toEqual({ document_id: "doc-exact" });
  });
});
