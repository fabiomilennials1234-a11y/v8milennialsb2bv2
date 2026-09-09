/**
 * send-document dedup gate — Layer 2 hard guard.
 *
 * Prevents the same document from being sent twice in the same conversation.
 * Exercises checkDocumentAlreadySent which queries pending_ai_actions.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Stub Deno global for ESM imports
vi.stubGlobal("Deno", {
  env: {
    get: (k: string) => {
      const m: Record<string, string> = {
        SUPABASE_URL: "https://local.test",
        SUPABASE_SERVICE_ROLE_KEY: "svc-role",
      };
      return m[k] ?? undefined;
    },
    toObject: () => ({}),
  },
  serve: () => {},
});

// Minimal mocks for transitive deps
vi.mock("../../supabase/functions/_shared/error-boundary.ts", () => ({
  withErrorBoundary: (_n: string, fn: unknown) => fn,
  logError: vi.fn(async () => {}),
  logEvent: vi.fn(async () => {}),
}));
vi.mock("../../supabase/functions/_shared/logger.ts", () => ({
  logRuntime: vi.fn(async () => {}),
  redactSecrets: (v: unknown) => v,
}));
vi.mock("../../supabase/functions/_shared/whatsapp-dispatch.ts", () => ({
  resolveDispatchContext: vi.fn(),
  DispatchResolutionError: class extends Error {},
}));
vi.mock("../../supabase/functions/_shared/copilot/cancellation.ts", () => ({
  isCopilotCanceled: vi.fn(async () => ({ canceled: false })),
  logCopilotCancellation: vi.fn(),
}));

import { checkDocumentAlreadySent, executeSendDocument, resolveDocumentIdByName, resolveDocumentIdByNearMiss } from "../../supabase/functions/_shared/actions/send-document.ts";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function buildSupabaseMock(resolvedValue: { data: any[] | null; error: any }) {
  // Supabase PostgREST chain: .from().select().eq().eq().in().neq() → Promise
  // Every method returns `this`; the chain is thenable (auto-resolves).
  const builder: any = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    neq: vi.fn(() => builder),
    // Make it thenable so `await` resolves to our value
    then: (resolve: any) => resolve(resolvedValue),
  };
  return {
    from: vi.fn(() => builder),
    _builder: builder,
  };
}

function buildSupabaseMockMultiTable(tables: Record<string, { data: any; error: any }>) {
  const fromFn = vi.fn((tableName: string) => {
    const resolved = tables[tableName] || { data: null, error: null };
    const builder: any = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      in: vi.fn(() => builder),
      neq: vi.fn(() => builder),
      ilike: vi.fn(() => builder),
      gte: vi.fn(() => builder),
      limit: vi.fn(() => builder),
      single: vi.fn(() => builder),
      maybeSingle: vi.fn(() => builder),
      then: (resolve: any) => resolve(resolved),
    };
    return builder;
  });
  return { from: fromFn };
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe("checkDocumentAlreadySent", () => {
  it("returns false when no prior send exists", async () => {
    const supabase = buildSupabaseMock({ data: [], error: null });
    const result = await checkDocumentAlreadySent(
      supabase as any,
      "conv-aaa",
      "doc-111",
    );
    expect(result).toBe(false);
  });

  it("returns true when same doc already sent in same conversation", async () => {
    const supabase = buildSupabaseMock({
      data: [{ id: "action-1", payload: { document_id: "doc-111" } }],
      error: null,
    });
    const result = await checkDocumentAlreadySent(
      supabase as any,
      "conv-aaa",
      "doc-111",
    );
    expect(result).toBe(true);
  });

  // ── O ciclo que se auto-alimentava ──────────────────────────────────────
  // A supressão devolvia `success:true`, o worker gravava `status='completed'`,
  // e ESTE gate lê exatamente as linhas `completed` da conversa. A supressão
  // virava a prova que suprimia a próxima tentativa — para sempre. Medido em
  // prod 2026-09-01: 353 de 769 envios `completed` eram repetição; numa amostra
  // de 30, só 3 tinham mensagem de mídia correspondente.

  it("NÃO bloqueia quando a ação anterior foi suprimida (não entregou)", async () => {
    const supabase = buildSupabaseMock({
      data: [
        {
          id: "action-1",
          payload: {
            document_id: "doc-111",
            suppressed_at: "2026-09-01T14:06:01.000Z",
            suppressed_reason: "duplicate_document",
          },
        },
      ],
      error: null,
    });
    const result = await checkDocumentAlreadySent(supabase as any, "conv-aaa", "doc-111");
    expect(result).toBe(false);
  });

  it("bloqueia quando a ação anterior foi ENTREGUE de fato", async () => {
    const supabase = buildSupabaseMock({
      data: [
        {
          id: "action-1",
          payload: {
            document_id: "doc-111",
            file_name: "Banho de Verniz - PRODUTO 1.png",
            delivered_at: "2026-09-01T14:04:08.000Z",
          },
        },
      ],
      error: null,
    });
    const result = await checkDocumentAlreadySent(supabase as any, "conv-aaa", "doc-111");
    expect(result).toBe(true);
  });

  it("uma entrega real prevalece sobre supressões anteriores do mesmo doc", async () => {
    const supabase = buildSupabaseMock({
      data: [
        { id: "a1", payload: { document_id: "doc-111", suppressed_at: "2026-09-01T14:03:52Z" } },
        { id: "a2", payload: { document_id: "doc-111", delivered_at: "2026-09-01T14:04:08Z" } },
      ],
      error: null,
    });
    const result = await checkDocumentAlreadySent(supabase as any, "conv-aaa", "doc-111");
    expect(result).toBe(true);
  });

  it("linha ANTIGA (sem carimbo) segue bloqueando — conservador por desenho", async () => {
    // Sem carimbo não dá pra saber se entregou. Assumir "não entregou" faria a
    // IA reenviar material que o lead já recebeu antes do conserto.
    const supabase = buildSupabaseMock({
      data: [{ id: "action-legado", payload: { document_id: "doc-111" } }],
      error: null,
    });
    const result = await checkDocumentAlreadySent(supabase as any, "conv-aaa", "doc-111");
    expect(result).toBe(true);
  });

  it("returns false when same doc sent in DIFFERENT conversation (query scoped)", async () => {
    // The function filters by conversation_id, so different conv → empty result.
    const supabase = buildSupabaseMock({ data: [], error: null });
    const result = await checkDocumentAlreadySent(
      supabase as any,
      "conv-bbb",
      "doc-111",
    );
    expect(result).toBe(false);
    // Verify conversation_id was passed to .eq()
    expect(supabase._builder.eq).toHaveBeenCalledWith("conversation_id", "conv-bbb");
  });

  it("returns false when different doc in same conversation", async () => {
    // Conversation has a completed send_document, but for a DIFFERENT document_id.
    // In-memory payload filter must reject the match.
    const supabase = buildSupabaseMock({
      data: [{ id: "action-1", payload: { document_id: "doc-111" } }],
      error: null,
    });
    const result = await checkDocumentAlreadySent(
      supabase as any,
      "conv-aaa",
      "doc-222",
    );
    expect(result).toBe(false);
  });

  it("returns true when action is in 'processing' status (retry-safe dedup)", async () => {
    // Action sent video successfully but crashed before marking completed.
    // Re-claim picks it up — dedup must still block.
    const supabase = buildSupabaseMock({
      data: [{ id: "action-1", payload: { document_id: "doc-111" } }],
      error: null,
    });
    const result = await checkDocumentAlreadySent(
      supabase as any,
      "conv-aaa",
      "doc-111",
    );
    expect(result).toBe(true);
    // Verify query includes both completed AND processing statuses
    expect(supabase._builder.in).toHaveBeenCalledWith(
      "status",
      ["completed", "processing"],
    );
  });

  it("returns true via whatsapp_messages fallback when a prior media msg matches the file basename", async () => {
    // Scenario: pending_ai_action was lost (cleanup, manual delete) but the
    // media itself was already delivered. whatsapp_messages secondary gate
    // catches it via media_url ILIKE on the storage path basename.
    const supabase = buildSupabaseMockMultiTable({
      pending_ai_actions: { data: [], error: null },
      whatsapp_messages: { data: [{ id: "wm-1" }], error: null },
      leads: { data: { phone: "+5581986416680" }, error: null },
    });
    const result = await checkDocumentAlreadySent(
      supabase as any,
      "conv-aaa",
      "doc-111",
      "lead-123",
      "org-x/agent-y/123_video.mp4",
    );
    expect(result).toBe(true);
  });

  it("returns false when no match in either pending_ai_actions or whatsapp_messages", async () => {
    const supabase = buildSupabaseMockMultiTable({
      pending_ai_actions: { data: [], error: null },
      whatsapp_messages: { data: [], error: null },
      leads: { data: { phone: "+5581986416680" }, error: null },
    });
    const result = await checkDocumentAlreadySent(
      supabase as any,
      "conv-aaa",
      "doc-111",
      "lead-123",
      "org-x/agent-y/123_video.mp4",
    );
    expect(result).toBe(false);
  });

  it("Barulinho regression: text reply in last 1h does NOT block a fresh video", async () => {
    // The previous fallback fired on ANY outgoing AI message in 1h, blocking
    // 100% of videos that followed engagement text. The fallback must only
    // trigger on a real media_url match for the same file basename.
    const supabase = buildSupabaseMockMultiTable({
      pending_ai_actions: { data: [], error: null },
      // ilike(media_url, %123_video.mp4%) → no match: query returns empty.
      whatsapp_messages: { data: [], error: null },
      leads: { data: { phone: "+5581986416680" }, error: null },
    });
    const result = await checkDocumentAlreadySent(
      supabase as any,
      "conv-aaa",
      "doc-111",
      "lead-123",
      "org-x/agent-y/123_video.mp4",
    );
    expect(result).toBe(false);
  });

  it("skips whatsapp_messages gate when no leadId provided", async () => {
    const supabase = buildSupabaseMock({ data: [], error: null });
    const result = await checkDocumentAlreadySent(
      supabase as any,
      "conv-aaa",
      "doc-111",
    );
    expect(result).toBe(false);
    // Only pending_ai_actions was queried (from() called once)
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });

  it("Barulinho regression: excludes own action row via currentActionId (self-block fix)", async () => {
    // Worker claims pending_ai_action → sets status='processing' → calls executor.
    // Before the fix, the dedup query matched the row itself and silently skipped
    // every legitimate send. With currentActionId passed in, `.neq("id", id)`
    // filters the row out and the gate clears.
    const supabase = buildSupabaseMock({ data: [], error: null });
    const result = await checkDocumentAlreadySent(
      supabase as any,
      "conv-aaa",
      "doc-111",
      null,
      null,
      "action-self",
    );
    expect(result).toBe(false);
    expect(supabase._builder.neq).toHaveBeenCalledWith("id", "action-self");
  });

  it("blocks when a DIFFERENT prior action for same doc is still processing/completed", async () => {
    // Self-exclude must not weaken real dedup. A different action row for the
    // same doc+conversation should still block.
    const supabase = buildSupabaseMock({
      data: [{ id: "action-prior", payload: { document_id: "doc-111" } }],
      error: null,
    });
    const result = await checkDocumentAlreadySent(
      supabase as any,
      "conv-aaa",
      "doc-111",
      null,
      null,
      "action-self",
    );
    expect(result).toBe(true);
  });

  it("does not call .neq when currentActionId is omitted (backwards compat)", async () => {
    const supabase = buildSupabaseMock({ data: [], error: null });
    await checkDocumentAlreadySent(supabase as any, "conv-aaa", "doc-111");
    expect(supabase._builder.neq).not.toHaveBeenCalled();
  });

  it("skips whatsapp_messages gate when no filePath provided", async () => {
    // leadId without filePath cannot perform a meaningful media_url match —
    // gate falls through rather than over-block.
    const supabase = buildSupabaseMock({ data: [], error: null });
    const result = await checkDocumentAlreadySent(
      supabase as any,
      "conv-aaa",
      "doc-111",
      "lead-123",
    );
    expect(result).toBe(false);
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });
});

describe("resolveDocumentIdByName", () => {
  // O modelo escolhe o arquivo pelo NOME na descrição da tool e às vezes devolve
  // esse nome no campo do id. Antes deste resolvedor o envio morria em silêncio.
  it("resolve o nome do arquivo para o UUID do documento", async () => {
    const supabase = buildSupabaseMockMultiTable({
      copilot_agent_documents: { data: [{ id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890" }], error: null },
    });
    const id = await resolveDocumentIdByName(
      supabase as any,
      "org-111",
      "Thermo Selagem - PRODUTO 1.jpg",
    );
    expect(id).toBe("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
  });

  it("devolve null quando nenhum arquivo casa", async () => {
    const supabase = buildSupabaseMockMultiTable({
      copilot_agent_documents: { data: [], error: null },
    });
    const id = await resolveDocumentIdByName(supabase as any, "org-111", "arquivo inexistente.jpg");
    expect(id).toBeNull();
  });

  it("devolve null para nome vazio (não varre a tabela)", async () => {
    const supabase = buildSupabaseMockMultiTable({
      copilot_agent_documents: { data: [{ id: "qualquer" }], error: null },
    });
    expect(await resolveDocumentIdByName(supabase as any, "org-111", "   ")).toBeNull();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("escapa curinga de ILIKE no nome do arquivo", async () => {
    const captured: string[] = [];
    const builder: any = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      limit: vi.fn(() => builder),
      ilike: vi.fn((_col: string, pattern: string) => { captured.push(pattern); return builder; }),
      then: (resolve: any) => resolve({ data: [], error: null }),
    };
    const supabase = { from: vi.fn(() => builder) };
    await resolveDocumentIdByName(supabase as any, "org-111", "100%_puro.jpg");
    expect(captured[0]).toBe("100\\%\\_puro.jpg");
  });
});

describe("executeSendDocument — resolução do document_id", () => {
  it("falha com 'not found' quando o nome não casa com nenhum documento", async () => {
    const supabase = buildSupabaseMockMultiTable({
      pending_ai_actions: { data: [], error: null },
      copilot_agent_documents: { data: [], error: null },
    });
    const result = await executeSendDocument(
      supabase as any,
      { document_id: "WhatsApp Video 2026-04-27 at 09.19.40.mp4" },
      "org-111",
      "lead-123",
      "conv-aaa",
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("accepts valid UUID document_id (fails downstream, not on validation)", async () => {
    const supabase = buildSupabaseMockMultiTable({
      pending_ai_actions: { data: [], error: null },
      leads: { data: null, error: null },
      copilot_agent_documents: { data: null, error: { message: "not found" } },
    });
    const result = await executeSendDocument(
      supabase as any,
      { document_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890" },
      "org-111",
      "lead-123",
      "conv-aaa",
    );
    // Fails on "Document not found", NOT on UUID validation
    expect(result.success).toBe(false);
    expect(result.error).not.toContain("invalid");
    expect(result.error).toContain("not found");
  });
});

/* ------------------------------------------------------------------ */
/* UUID quase-certo — o modelo trocou um dígito                        */
/* ------------------------------------------------------------------ */

describe("resolveDocumentIdByNearMiss", () => {
  // Caso real, Forever Bella 02/09/2026: o modelo pediu `…-3e3a-…` duas vezes;
  // o arquivo é `…-3f3a-…`. Duas ações morreram em dead_letter depois de 3
  // retries — retry nunca conserta um dígito errado.
  const REAL = "c3213b6b-3f3a-4629-83d4-f4fdb68eb0be";
  const TYPO = "c3213b6b-3e3a-4629-83d4-f4fdb68eb0be";

  const withDocs = (ids: string[]) =>
    buildSupabaseMockMultiTable({
      copilot_agent_documents: { data: ids.map((id) => ({ id })), error: null },
    });

  it("resgata o documento quando exatamente UM está a um caractere de distância", async () => {
    const supabase = withDocs([REAL, "0afa30d8-9e9a-4981-95d8-eda2bc9208ba"]);
    expect(await resolveDocumentIdByNearMiss(supabase as any, "org-111", TYPO)).toBe(REAL);
  });

  it("devolve null com DOIS candidatos a um caractere — mandar o arquivo errado é pior", async () => {
    const ambiguous = "c3213b6b-3a3a-4629-83d4-f4fdb68eb0be";
    const supabase = withDocs([REAL, ambiguous]);
    expect(await resolveDocumentIdByNearMiss(supabase as any, "org-111", TYPO)).toBeNull();
  });

  it("não resgata quando a distância é maior que um caractere", async () => {
    const supabase = withDocs(["c3213b6b-3f3a-4629-83d4-f4fdb68eb0ff"]);
    expect(await resolveDocumentIdByNearMiss(supabase as any, "org-111", TYPO)).toBeNull();
  });

  it("devolve null quando a org não tem documento nenhum", async () => {
    const supabase = withDocs([]);
    expect(await resolveDocumentIdByNearMiss(supabase as any, "org-111", TYPO)).toBeNull();
  });
});
