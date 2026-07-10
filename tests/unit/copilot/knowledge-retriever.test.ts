/**
 * KnowledgeRetriever — deep module consolidating rag.ts + search-knowledge.ts
 *
 * Single interface, mode-based thresholds:
 *   initial: context injection (higher thresholds, smaller results)
 *   tool: multi-turn search (lower thresholds, larger results, includes available docs)
 *   memories: lead long-term memories
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

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

const mockGenerateEmbedding = vi.fn().mockResolvedValue([0.1, 0.2, 0.3]);
vi.mock("../../../supabase/functions/_shared/embeddings.ts", () => ({
  generateEmbedding: (...args: unknown[]) => mockGenerateEmbedding(...args),
  generateEmbeddingsBatch: vi.fn(),
}));

vi.mock("../../../supabase/functions/_shared/error-boundary.ts", () => ({
  withErrorBoundary: (_n: string, fn: unknown) => fn,
  logError: vi.fn(async () => {}),
  logEvent: vi.fn(async () => {}),
}));

vi.mock("../../../supabase/functions/_shared/logger.ts", () => ({
  logRuntime: vi.fn(async () => {}),
  redactSecrets: (v: unknown) => v,
}));

import { KnowledgeRetriever } from "../../../supabase/functions/_shared/copilot/knowledge-retriever.ts";

function buildMockSupabase(rpcResults: Record<string, { data: any; error: any }>, tableResults?: Record<string, any>) {
  return {
    rpc: vi.fn((name: string, params: any) => {
      const result = rpcResults[name] ?? { data: null, error: null };
      return Promise.resolve(result);
    }),
    from: vi.fn((table: string) => {
      const builder: any = {
        select: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        then: (r: any) => r(tableResults?.[table] ?? { data: [], error: null }),
      };
      return builder;
    }),
  };
}

describe("KnowledgeRetriever", () => {
  beforeEach(() => {
    mockGenerateEmbedding.mockClear();
    mockGenerateEmbedding.mockResolvedValue([0.1, 0.2, 0.3]);
  });

  describe("retrieve (initial mode)", () => {
    it("returns formatted docs + FAQs with initial thresholds", async () => {
      const supabase = buildMockSupabase({
        match_document_chunks: {
          data: [{ content: "chunk content here", similarity: 0.8 }],
          error: null,
        },
        match_faqs: {
          data: [{ question: "How?", answer: "Like this.", similarity: 0.7 }],
          error: null,
        },
      });

      const retriever = new KnowledgeRetriever(supabase as any);
      const result = await retriever.retrieve("user question", "agent-1", "initial");

      expect(result).toContain("chunk content here");
      expect(result).toContain("How?");
      expect(result).toContain("Like this.");

      // Verify initial-mode thresholds
      expect(supabase.rpc).toHaveBeenCalledWith("match_document_chunks", expect.objectContaining({
        match_count: 6,
        similarity_threshold: 0.6,
      }));
      expect(supabase.rpc).toHaveBeenCalledWith("match_faqs", expect.objectContaining({
        match_count: 4,
        similarity_threshold: 0.65,
      }));
    });

    it("returns empty string when no results found", async () => {
      const supabase = buildMockSupabase({
        match_document_chunks: { data: [], error: null },
        match_faqs: { data: [], error: null },
      });

      const retriever = new KnowledgeRetriever(supabase as any);
      const result = await retriever.retrieve("user question", "agent-1", "initial");

      expect(result).toBe("");
    });

    it("returns empty string when GEMINI_API_KEY missing", async () => {
      vi.stubGlobal("Deno", {
        env: { get: () => undefined, toObject: () => ({}) },
        serve: () => {},
      });

      const supabase = buildMockSupabase({});
      const retriever = new KnowledgeRetriever(supabase as any);
      const result = await retriever.retrieve("user question", "agent-1", "initial");

      expect(result).toBe("");
      expect(mockGenerateEmbedding).not.toHaveBeenCalled();

      // Restore
      vi.stubGlobal("Deno", {
        env: {
          get: (k: string) => ({ GEMINI_API_KEY: "fake-key", SUPABASE_URL: "https://local.test", SUPABASE_SERVICE_ROLE_KEY: "svc-role" }[k]),
          toObject: () => ({}),
        },
        serve: () => {},
      });
    });
  });

  describe("retrieve (tool mode)", () => {
    it("uses lower thresholds and includes available docs", async () => {
      const supabase = buildMockSupabase(
        {
          match_document_chunks: {
            data: [{ content: "found info", similarity: 0.5 }],
            error: null,
          },
          match_faqs: { data: [], error: null },
        },
        {
          copilot_agent_documents: {
            data: [{ id: "doc-1", file_name: "catalog.pdf" }],
            error: null,
          },
        },
      );

      const retriever = new KnowledgeRetriever(supabase as any);
      const result = await retriever.retrieve("search query", "agent-1", "tool");

      // Tool mode thresholds (tuned in #229)
      expect(supabase.rpc).toHaveBeenCalledWith("match_document_chunks", expect.objectContaining({
        match_count: 5,
        similarity_threshold: 0.55,
      }));
      expect(supabase.rpc).toHaveBeenCalledWith("match_faqs", expect.objectContaining({
        match_count: 4,
        similarity_threshold: 0.5,
      }));

      expect(result).toContain("found info");
      expect(result).toContain("catalog.pdf");
      expect(result).toContain("send_document");
    });

    it("returns error message when no results in tool mode", async () => {
      const supabase = buildMockSupabase(
        {
          match_document_chunks: { data: [], error: null },
          match_faqs: { data: [], error: null },
        },
        {
          copilot_agent_documents: { data: [], error: null },
        },
      );

      const retriever = new KnowledgeRetriever(supabase as any);
      const result = await retriever.retrieve("obscure query", "agent-1", "tool");

      expect(result).toContain("Nenhuma informacao encontrada");
    });
  });

  describe("retrieveMemories", () => {
    it("returns formatted lead memories sorted by importance", async () => {
      const supabase = buildMockSupabase({
        match_lead_memories: {
          data: [
            { memory_type: "preference", content: "Prefers email", importance: 3 },
            { memory_type: "objection", content: "Price too high", importance: 8 },
          ],
          error: null,
        },
      });

      const retriever = new KnowledgeRetriever(supabase as any);
      const result = await retriever.retrieveMemories("follow up", "lead-1");

      // Should be sorted by importance DESC
      expect(result.indexOf("Price too high")).toBeLessThan(result.indexOf("Prefers email"));
      expect(result).toContain("[OBJECTION]");
      expect(result).toContain("[PREFERENCE]");
    });

    it("returns empty string when no memories", async () => {
      const supabase = buildMockSupabase({
        match_lead_memories: { data: [], error: null },
      });

      const retriever = new KnowledgeRetriever(supabase as any);
      const result = await retriever.retrieveMemories("question", "lead-1");

      expect(result).toBe("");
    });
  });

  describe("embedding reuse", () => {
    it("generates embedding only once per retrieve call", async () => {
      const supabase = buildMockSupabase({
        match_document_chunks: { data: [], error: null },
        match_faqs: { data: [], error: null },
      });

      const retriever = new KnowledgeRetriever(supabase as any);
      await retriever.retrieve("question", "agent-1", "initial");

      expect(mockGenerateEmbedding).toHaveBeenCalledTimes(1);
    });
  });
});
