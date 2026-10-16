import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Dublê do supabase-js: grava cada chamada da cadeia e devolve o resultado
 * programado por tabela/operação.
 */
const mocks = vi.hoisted(() => {
  type Result = { data?: unknown; error?: unknown };
  const calls: Array<{ table: string; op: string; payload?: unknown; filters: Array<[string, ...unknown[]]> }> = [];
  const results: Record<string, Result | (() => Result | Promise<Result>) | Error> = {};
  function from(table: string) {
    const call = { table, op: "", payload: undefined as unknown, filters: [] as Array<[string, ...unknown[]]> };
    calls.push(call);
    const settle = () => {
      const programmed = results[`${table}.${call.op}`];
      if (programmed instanceof Error) return Promise.reject(programmed);
      const value = typeof programmed === "function" ? programmed() : programmed;
      return Promise.resolve(value).then((v) => ({ data: null, error: null, ...(v ?? {}) }));
    };
    const builder: Record<string, unknown> = {
      select: (cols: string) => ((call.op = "select"), call.filters.push(["select", cols]), builder),
      insert: (payload: unknown) => ((call.op = "insert"), (call.payload = payload), builder),
      update: (payload: unknown) => ((call.op = "update"), (call.payload = payload), builder),
      eq: (col: string, value: unknown) => (call.filters.push(["eq", col, value]), builder),
      is: (col: string, value: unknown) => (call.filters.push(["is", col, value]), builder),
      maybeSingle: () => settle(),
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => settle().then(resolve, reject),
    };
    return builder;
  }
  return { calls, results, from, user: { id: "user-1" } as { id: string } | null };
});

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from } }));
vi.mock("@/modules/identity", () => ({ useAuth: () => ({ user: mocks.user }) }));

import { usePromptImpression } from "@/modules/platform/hooks/usePromptImpression";
import {
  FeatureSuggestionError,
  submitFeatureSuggestion,
} from "@/modules/platform/hooks/useSubmitFeatureSuggestion";

const KEY = "feature_suggestions_2026_10";

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  mocks.calls.length = 0;
  for (const key of Object.keys(mocks.results)) delete mocks.results[key];
  mocks.user = { id: "user-1" };
});

describe("usePromptImpression", () => {
  it("sem linha → unseen; consulta só a linha do próprio usuário e da chave", async () => {
    mocks.results["user_prompt_impressions.select"] = { data: null };
    const { result } = renderHook(() => usePromptImpression(KEY, { enabled: true }), { wrapper: wrapper() });
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("unseen"));
    expect(mocks.calls[0].filters).toEqual([
      ["select", "prompt_key"],
      ["eq", "user_id", "user-1"],
      ["eq", "prompt_key", KEY],
    ]);
  });

  it("com linha → seen", async () => {
    mocks.results["user_prompt_impressions.select"] = { data: { prompt_key: KEY } };
    const { result } = renderHook(() => usePromptImpression(KEY, { enabled: true }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.status).toBe("seen"));
  });

  it.each(["PGRST205", "42P01", "500"])("erro %s → error (falha fecha)", async (code) => {
    mocks.results["user_prompt_impressions.select"] = { error: { code, message: "x" } };
    const { result } = renderHook(() => usePromptImpression(KEY, { enabled: true }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.status).toBe("error"));
  });

  it("desabilitado não consulta", async () => {
    renderHook(() => usePromptImpression(KEY, { enabled: false }), { wrapper: wrapper() });
    await new Promise((r) => setTimeout(r, 10));
    expect(mocks.calls).toHaveLength(0);
  });

  it("claim: INSERT só de prompt_key; sucesso → true e status vira claimed", async () => {
    mocks.results["user_prompt_impressions.select"] = { data: null };
    mocks.results["user_prompt_impressions.insert"] = {};
    const { result } = renderHook(() => usePromptImpression(KEY, { enabled: true }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.status).toBe("unseen"));
    let claimed = false;
    await act(async () => {
      claimed = await result.current.claim();
    });
    expect(claimed).toBe(true);
    const insert = mocks.calls.find((c) => c.op === "insert");
    expect(insert?.payload).toEqual({ prompt_key: KEY });
    await waitFor(() => expect(result.current.status).toBe("claimed"));
    // Resolver o desfecho encerra: claimed → seen.
    await act(async () => {
      await result.current.resolve("dismissed");
    });
    await waitFor(() => expect(result.current.status).toBe("seen"));
  });

  it("claimed sobrevive à remontagem (mesmo QueryClient) sem nova consulta", async () => {
    mocks.results["user_prompt_impressions.select"] = { data: null };
    mocks.results["user_prompt_impressions.insert"] = {};
    const Wrapper = wrapper();
    const first = renderHook(() => usePromptImpression(KEY, { enabled: true }), { wrapper: Wrapper });
    await waitFor(() => expect(first.result.current.status).toBe("unseen"));
    await act(async () => {
      await first.result.current.claim();
    });
    first.unmount();
    const selectsBefore = mocks.calls.filter((c) => c.op === "select").length;
    const second = renderHook(() => usePromptImpression(KEY, { enabled: true }), { wrapper: Wrapper });
    expect(second.result.current.status).toBe("claimed");
    await new Promise((r) => setTimeout(r, 10));
    expect(mocks.calls.filter((c) => c.op === "select").length).toBe(selectsBefore);
  });

  it.each([
    ["23505 (outra aba chegou antes)", { error: { code: "23505", message: "dup" } }],
    ["RLS", { error: { code: "42501", message: "rls" } }],
  ])("claim com %s → false e status seen", async (_label, outcome) => {
    mocks.results["user_prompt_impressions.select"] = { data: null };
    mocks.results["user_prompt_impressions.insert"] = outcome;
    const { result } = renderHook(() => usePromptImpression(KEY, { enabled: true }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.status).toBe("unseen"));
    let claimed = true;
    await act(async () => {
      claimed = await result.current.claim();
    });
    expect(claimed).toBe(false);
    await waitFor(() => expect(result.current.status).toBe("seen"));
  });

  it("claim com rede caída → false, sem lançar", async () => {
    mocks.results["user_prompt_impressions.insert"] = new Error("network");
    const { result } = renderHook(() => usePromptImpression(KEY, { enabled: true }), { wrapper: wrapper() });
    await expect(result.current.claim()).resolves.toBe(false);
  });

  it("claim sem usuário → false, sem chamada", async () => {
    mocks.user = null;
    const { result } = renderHook(() => usePromptImpression(KEY, { enabled: true }), { wrapper: wrapper() });
    await expect(result.current.claim()).resolves.toBe(false);
    expect(mocks.calls).toHaveLength(0);
  });

  it("resolve grava o desfecho só onde ainda é NULL e engole falha", async () => {
    mocks.results["user_prompt_impressions.update"] = new Error("network");
    const { result } = renderHook(() => usePromptImpression(KEY, { enabled: false }), { wrapper: wrapper() });
    await expect(result.current.resolve("dismissed")).resolves.toBeUndefined();
    const update = mocks.calls.find((c) => c.op === "update");
    expect(update?.payload).toEqual({ outcome: "dismissed" });
    expect(update?.filters).toEqual([
      ["eq", "user_id", "user-1"],
      ["eq", "prompt_key", KEY],
      ["is", "outcome", null],
    ]);
  });
});

describe("submitFeatureSuggestion", () => {
  const input = { organizationId: "org-1", kind: "integration" as const, body: "  Integração com Omie  " };

  it("payload só com colunas que o cliente pode escrever, texto aparado", async () => {
    mocks.results["feature_suggestions.insert"] = {};
    await submitFeatureSuggestion(input);
    expect(mocks.calls[0]).toMatchObject({
      table: "feature_suggestions",
      op: "insert",
      payload: { organization_id: "org-1", kind: "integration", body: "Integração com Omie" },
    });
    expect(Object.keys(mocks.calls[0].payload as object).sort()).toEqual(["body", "kind", "organization_id"]);
  });

  it("23505 (já enviou) é sucesso idempotente", async () => {
    mocks.results["feature_suggestions.insert"] = { error: { code: "23505", message: "dup" } };
    await expect(submitFeatureSuggestion(input)).resolves.toBeUndefined();
  });

  it("erro sai só com o código: sem mensagem, details nem o texto (PII)", async () => {
    mocks.results["feature_suggestions.insert"] = {
      error: { code: "23514", message: "Failing row contains Integração com Omie", details: "Integração com Omie" },
    };
    const error = await submitFeatureSuggestion(input).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FeatureSuggestionError);
    expect((error as FeatureSuggestionError).code).toBe("23514");
    expect(JSON.stringify({ m: (error as Error).message, ...(error as object) })).not.toContain("Omie");
  });

  it("rede caída → código network", async () => {
    mocks.results["feature_suggestions.insert"] = new Error("Failed to fetch Omie");
    const error = await submitFeatureSuggestion(input).catch((e: unknown) => e);
    expect((error as FeatureSuggestionError).code).toBe("network");
    expect((error as Error).message).not.toContain("Omie");
  });

  it("texto inválido nem chega ao banco", async () => {
    await expect(submitFeatureSuggestion({ ...input, body: "  a " })).rejects.toBeInstanceOf(FeatureSuggestionError);
    expect(mocks.calls).toHaveLength(0);
  });
});

describe("usePromptImpression — claim em voo compartilhado", () => {
  it("duas montagens durante o INSERT: um INSERT só, os dois recebem true, status claiming → claimed", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    mocks.results["user_prompt_impressions.select"] = { data: null };
    mocks.results["user_prompt_impressions.insert"] = () => gate.then(() => ({}));
    const Wrapper = wrapper();
    const first = renderHook(() => usePromptImpression(KEY, { enabled: true }), { wrapper: Wrapper });
    await waitFor(() => expect(first.result.current.status).toBe("unseen"));

    let a!: Promise<boolean>;
    act(() => {
      a = first.result.current.claim();
    });
    await waitFor(() => expect(first.result.current.status).toBe("claiming"));
    // Troca de rota no meio do INSERT: desmonta e monta de novo.
    first.unmount();
    const second = renderHook(() => usePromptImpression(KEY, { enabled: true }), { wrapper: Wrapper });
    expect(second.result.current.status).toBe("claiming");
    let b!: Promise<boolean>;
    act(() => {
      b = second.result.current.claim();
    });
    release();
    await expect(a).resolves.toBe(true);
    await expect(b).resolves.toBe(true);
    expect(mocks.calls.filter((c) => c.op === "insert")).toHaveLength(1);
    await waitFor(() => expect(second.result.current.status).toBe("claimed"));
    // Já claimed: novo claim devolve true sem INSERT.
    await expect(second.result.current.claim()).resolves.toBe(true);
    expect(mocks.calls.filter((c) => c.op === "insert")).toHaveLength(1);
  });

  it("23505 tardio não rebaixa um claimed já obtido", async () => {
    mocks.results["user_prompt_impressions.select"] = { data: null };
    mocks.results["user_prompt_impressions.insert"] = {};
    const Wrapper = wrapper();
    const { result } = renderHook(() => usePromptImpression(KEY, { enabled: true }), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.status).toBe("unseen"));
    await act(async () => {
      await result.current.claim();
    });
    await waitFor(() => expect(result.current.status).toBe("claimed"));
    // Mesmo que algo force outro INSERT e ele volte 23505, claimed fica.
    mocks.results["user_prompt_impressions.insert"] = { error: { code: "23505", message: "dup" } };
    await act(async () => {
      await expect(result.current.claim()).resolves.toBe(true);
    });
    expect(result.current.status).toBe("claimed");
  });
});

