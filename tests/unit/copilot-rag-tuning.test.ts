/**
 * RAG Quality Tuning — threshold + chunks + prompt instruction
 * Issue #229
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Deno stub ──────────────────────────────────────────────────────────────
vi.stubGlobal("Deno", {
  env: {
    get: (k: string) => {
      const m: Record<string, string> = {
        GEMINI_API_KEY: "fake-key",
        SUPABASE_URL: "https://local.test",
        SUPABASE_SERVICE_ROLE_KEY: "svc-role",
      };
      return m[k] ?? undefined;
    },
    toObject: () => ({}),
  },
  serve: () => {},
});

// ─── Mocks ──────────────────────────────────────────────────────────────────
const mockGenerateEmbedding = vi.fn().mockResolvedValue([0.1, 0.2, 0.3]);
vi.mock("../../supabase/functions/_shared/embeddings.ts", () => ({
  generateEmbedding: (...args: unknown[]) => mockGenerateEmbedding(...args),
  generateEmbeddingsBatch: vi.fn(),
}));

vi.mock("../../supabase/functions/_shared/error-boundary.ts", () => ({
  withErrorBoundary: (_n: string, fn: unknown) => fn,
  logError: vi.fn(async () => {}),
  logEvent: vi.fn(async () => {}),
}));

vi.mock("../../supabase/functions/_shared/logger.ts", () => ({
  logRuntime: vi.fn(async () => {}),
  redactSecrets: (v: unknown) => v,
}));

vi.mock("../../supabase/functions/_shared/copilot/time-context.ts", () => ({
  resolveActiveWindow: vi.fn(() => null),
  formatNowText: vi.fn(() => "quarta-feira, 28/05/2026 14:00 (America/Sao_Paulo)"),
  getDayKeyInTimezone: vi.fn(() => "wed"),
}));

vi.mock("../../supabase/functions/agent-message/engine/utils.ts", () => ({
  parseCustomInstructions: vi.fn(() => ({ dos: "", donts: "" })),
}));

// ─── Imports (after mocks) ──────────────────────────────────────────────────
import { executeSearchKnowledge } from "../../supabase/functions/_shared/copilot/search-knowledge.ts";
import { KnowledgeRetriever } from "../../supabase/functions/_shared/copilot/knowledge-retriever.ts";
import { buildDynamicPrompt, type BuildPromptParams } from "../../supabase/functions/agent-message/engine/build-prompt.ts";

// ─── Helpers ────────────────────────────────────────────────────────────────
function buildMockSupabase(rpcResults: Record<string, { data: any; error: any }>, tableResults?: Record<string, any>) {
  return {
    rpc: vi.fn((name: string) => {
      const result = rpcResults[name] ?? { data: null, error: null };
      return Promise.resolve(result);
    }),
    from: vi.fn((table: string) => {
      const builder: any = {
        select: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        not: vi.fn(() => builder),
        order: vi.fn(() => builder),
        limit: vi.fn(() => builder),
        maybeSingle: vi.fn(() => Promise.resolve(tableResults?.[table] ?? { data: null, error: null })),
        then: (r: any) => r(tableResults?.[table] ?? { data: [], error: null }),
      };
      return builder;
    }),
  };
}

function makeMinimalPromptParams(overrides: Partial<BuildPromptParams> = {}): BuildPromptParams {
  const supabase = buildMockSupabase({}, {
    lead_history: { data: null, error: null },
  });
  return {
    supabase: supabase as any,
    capabilities: { name: "Agente Teste" },
    conversation: { state: "active", turn_count: 1, context: {} },
    currentLeadId: "lead-1",
    conversationContext: null,
    incomingMessageType: "text",
    ...overrides,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// CYCLE 1: search_knowledge uses threshold 0.55 and match_count 5
// ═════════════════════════════════════════════════════════════════════════════
describe("RAG tuning — search thresholds", () => {
  beforeEach(() => {
    mockGenerateEmbedding.mockClear();
    mockGenerateEmbedding.mockResolvedValue([0.1, 0.2, 0.3]);
  });

  describe("executeSearchKnowledge (legacy)", () => {
    it("chama match_document_chunks com threshold 0.55 e match_count 5", async () => {
      const supabase = buildMockSupabase({
        match_document_chunks: { data: [], error: null },
        match_faqs: { data: [], error: null },
      }, {
        copilot_agent_documents: { data: [], error: null },
      });

      await executeSearchKnowledge(supabase as any, "teste", "agent-1");

      expect(supabase.rpc).toHaveBeenCalledWith("match_document_chunks", expect.objectContaining({
        match_count: 5,
        similarity_threshold: 0.55,
      }));
    });
  });

  describe("KnowledgeRetriever (tool mode)", () => {
    it("chama match_document_chunks com threshold 0.55 e match_count 5", async () => {
      const supabase = buildMockSupabase({
        match_document_chunks: { data: [], error: null },
        match_faqs: { data: [], error: null },
      }, {
        copilot_agent_documents: { data: [], error: null },
      });

      const retriever = new KnowledgeRetriever(supabase as any);
      await retriever.retrieve("teste", "agent-1", "tool");

      expect(supabase.rpc).toHaveBeenCalledWith("match_document_chunks", expect.objectContaining({
        match_count: 5,
        similarity_threshold: 0.55,
      }));
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CYCLE 2: build-prompt includes mandatory search_knowledge instruction
//          when agent has documents
// ═════════════════════════════════════════════════════════════════════════════
describe("RAG tuning — prompt instruction with documents", () => {
  it("inclui instrucao obrigatoria de search_knowledge quando agente tem documentos", async () => {
    const params = makeMinimalPromptParams({
      documentSummaries: [
        { file_name: "catalogo.pdf", summary: "Catalogo de produtos" },
      ],
    });

    const prompt = await buildDynamicPrompt(params);

    expect(prompt).toContain(
      "SEMPRE consulte a base de conhecimento via search_knowledge antes de responder perguntas sobre produtos, precos, servicos, especificacoes tecnicas ou informacoes da empresa."
    );
    expect(prompt).toContain(
      "Nao responda de memoria quando houver documentos disponiveis."
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CYCLE 3: instruction is NOT present when agent has no documents
// ═════════════════════════════════════════════════════════════════════════════
describe("RAG tuning — no instruction without documents", () => {
  it("NAO inclui instrucao de search_knowledge quando agente nao tem documentos", async () => {
    const params = makeMinimalPromptParams({
      documentSummaries: undefined,
    });

    const prompt = await buildDynamicPrompt(params);

    expect(prompt).not.toContain("SEMPRE consulte a base de conhecimento via search_knowledge");
    expect(prompt).not.toContain("Nao responda de memoria quando houver documentos disponiveis.");
  });

  it("NAO inclui instrucao de search_knowledge quando lista de documentos esta vazia", async () => {
    const params = makeMinimalPromptParams({
      documentSummaries: [],
    });

    const prompt = await buildDynamicPrompt(params);

    expect(prompt).not.toContain("SEMPRE consulte a base de conhecimento via search_knowledge");
    expect(prompt).not.toContain("Nao responda de memoria quando houver documentos disponiveis.");
  });
});
