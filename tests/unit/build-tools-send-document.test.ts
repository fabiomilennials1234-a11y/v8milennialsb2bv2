/**
 * buildDynamicTools — send_document tool surfaces the operator's send trigger.
 *
 * Verifies that when a ready KB document carries `send_when`, the tool
 * description lists it as "[Enviar quando: ...]", and that a document WITHOUT
 * send_when does not add the bracket and does not break the build.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildDynamicTools } from "../../supabase/functions/agent-message/engine/build-tools.ts";

type Doc = { id: string; file_name: string; summary: string | null; send_when: string | null };

function makeSupabase(docs: Doc[]) {
  return {
    from(table: string) {
      const state: { isCount: boolean } = { isCount: false };
      const chain: Record<string, any> = {};
      chain.select = (_cols: string, opts?: { head?: boolean }) => {
        state.isCount = !!(opts && opts.head);
        return chain;
      };
      ["eq", "in", "order", "limit"].forEach((m) => {
        chain[m] = () => chain;
      });
      chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
      chain.then = (resolve: any, reject?: any) => {
        let result: any;
        if (table === "copilot_agent_documents") {
          result = state.isCount ? { count: docs.length, error: null } : { data: docs, error: null };
        } else {
          result = { data: [], error: null };
        }
        return Promise.resolve(result).then(resolve, reject);
      };
      return chain;
    },
  };
}

const baseParams = (docs: Doc[]) => ({
  supabase: makeSupabase(docs) as any,
  organizationId: "org-1",
  capabilities: { id: "agent-1" } as any,
  orgCustomFields: [],
  pipelineStages: [],
});

describe("buildDynamicTools — send_document trigger", () => {
  beforeEach(() => vi.clearAllMocks());

  it("includes the send_when trigger in the tool description", async () => {
    const tools = await buildDynamicTools(
      baseParams([
        { id: "d1", file_name: "Catalogo.pdf", summary: "Catalogo 2026", send_when: "quando o lead pedir o catalogo" },
      ]),
    );
    const sendDoc = tools.find((t) => t.name === "send_document");
    expect(sendDoc).toBeDefined();
    expect(sendDoc.description).toContain("Catalogo.pdf");
    expect(sendDoc.description).toContain("[Enviar quando: quando o lead pedir o catalogo]");
  });

  it("omits the trigger bracket when send_when is null and still builds", async () => {
    const tools = await buildDynamicTools(
      baseParams([{ id: "d2", file_name: "Proposta.pdf", summary: null, send_when: null }]),
    );
    const sendDoc = tools.find((t) => t.name === "send_document");
    expect(sendDoc).toBeDefined();
    expect(sendDoc.description).toContain("Proposta.pdf");
    expect(sendDoc.description).not.toContain("Enviar quando");
  });
});
