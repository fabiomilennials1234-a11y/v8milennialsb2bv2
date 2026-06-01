/**
 * resolve-org-capabilities.test.ts
 *
 * TDD for PRD #544 / Slice #549 — the Builder reads real org state so it wires
 * only what exists and never invents stages.
 */

import { describe, it, expect } from "vitest";
import {
  resolveOrgCapabilities,
  describeOrgCapabilities,
} from "../../supabase/functions/_shared/resolve-org-capabilities.ts";

/** Chainable supabase-client mock returning canned data per table. */
function makeClient(tables: Record<string, { data: unknown }>) {
  return {
    from(table: string) {
      const result = tables[table] ?? { data: null };
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: () => Promise.resolve(result),
        then: (res: (v: unknown) => unknown) => Promise.resolve(result).then(res),
      };
      return chain;
    },
  };
}

describe("resolveOrgCapabilities", () => {
  it("groups pipeline stages by pipeline_type, in order", async () => {
    const client = makeClient({
      pipeline_stages: {
        data: [
          { pipeline_type: "whatsapp", name: "Novo" },
          { pipeline_type: "whatsapp", name: "Abordado" },
          { pipeline_type: "propostas", name: "Enviada" },
        ],
      },
    });

    const caps = await resolveOrgCapabilities(client, "org-1");

    const wpp = caps.pipelines.find((p) => p.pipelineType === "whatsapp");
    expect(wpp?.stages).toEqual(["Novo", "Abordado"]);
    expect(caps.pipelines.find((p) => p.pipelineType === "propostas")?.stages).toEqual([
      "Enviada",
    ]);
  });

  it("flags sz_chat configured only when team_mappings is non-empty", async () => {
    const on = await resolveOrgCapabilities(
      makeClient({ sz_chat_config: { data: { team_mappings: { suporte: "x" } } } }),
      "org-1",
    );
    expect(on.szChatConfigured).toBe(true);

    const off = await resolveOrgCapabilities(
      makeClient({ sz_chat_config: { data: { team_mappings: {} } } }),
      "org-1",
    );
    expect(off.szChatConfigured).toBe(false);
  });

  it("reports knowledge docs only when the agent has ready documents", async () => {
    const withDocs = await resolveOrgCapabilities(
      makeClient({ copilot_agent_documents: { data: [{ id: "d1" }] } }),
      "org-1",
      "agent-1",
    );
    expect(withDocs.hasKnowledgeDocs).toBe(true);

    const noDocs = await resolveOrgCapabilities(
      makeClient({ copilot_agent_documents: { data: [] } }),
      "org-1",
      "agent-1",
    );
    expect(noDocs.hasKnowledgeDocs).toBe(false);
  });

  it("describeOrgCapabilities lists real stages and warns about missing deps", () => {
    const text = describeOrgCapabilities({
      pipelines: [{ pipelineType: "whatsapp", stages: ["Novo", "Abordado"] }],
      szChatConfigured: false,
      hasKnowledgeDocs: false,
    });
    expect(text).toContain("Novo, Abordado");
    expect(text).toContain("nunca invente");
    expect(text).toMatch(/SZ\.Chat: N[ÃA]O configurado/);
    expect(text).toContain("peça o upload");
  });
});
