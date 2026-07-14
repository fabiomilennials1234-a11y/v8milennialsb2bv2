/**
 * useOrgUtmValues — sugere valores UTM distintos da org para o node de condição.
 *
 * Cobre: dedup + sort pt-BR, allowlist ESTRITA de coluna, e `enabled` só com
 * orgId + campo UTM (org vem de useOrganization, NÃO de useAuth).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createWrapper } from "../../../../../tests/helpers/hook-test-utils";

// Org mock mutável — trocado por teste.
const orgState: { organizationId: string | null; isReady: boolean } = {
  organizationId: "org-1",
  isReady: true,
};
vi.mock("@/modules/identity", () => ({
  useOrganization: () => orgState,
}));

// Builder supabase inspecionável — a cadeia usa .select().eq().not().neq().limit().
const limitResult: { data: unknown[]; error: unknown } = { data: [], error: null };
const builder = {
  select: vi.fn(() => builder),
  eq: vi.fn(() => builder),
  not: vi.fn(() => builder),
  neq: vi.fn(() => builder),
  limit: vi.fn(() => Promise.resolve(limitResult)),
};
const fromMock = vi.fn((..._args: unknown[]) => builder);
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (...a: unknown[]) => fromMock(...a) },
}));

import { useOrgUtmValues, isUtmValueField, UTM_VALUE_FIELDS } from "../useOrgUtmValues";

beforeEach(() => {
  orgState.organizationId = "org-1";
  orgState.isReady = true;
  limitResult.data = [];
  limitResult.error = null;
  fromMock.mockClear();
  builder.select.mockClear();
  builder.eq.mockClear();
  builder.not.mockClear();
  builder.neq.mockClear();
  builder.limit.mockClear();
});

describe("isUtmValueField / allowlist", () => {
  it("aceita só os 5 campos UTM", () => {
    expect([...UTM_VALUE_FIELDS].sort()).toEqual([
      "utm_campaign",
      "utm_content",
      "utm_medium",
      "utm_source",
      "utm_term",
    ]);
    expect(isUtmValueField("utm_campaign")).toBe(true);
    expect(isUtmValueField("score")).toBe(false);
    expect(isUtmValueField("custom.cargo")).toBe(false);
    expect(isUtmValueField(undefined)).toBe(false);
  });
});

describe("useOrgUtmValues", () => {
  it("deduplica, remove vazio/null e ordena (pt-BR, case-insensitive)", async () => {
    limitResult.data = [
      { utm_campaign: "B" },
      { utm_campaign: "a" },
      { utm_campaign: "B" },
      { utm_campaign: "" },
      { utm_campaign: null },
      { utm_campaign: "c" },
    ];

    const { result } = renderHook(() => useOrgUtmValues("utm_campaign"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.values).toEqual(["a", "B", "c"]);
  });

  it("monta o select com a coluna UTM + filtros org/not-null/not-empty/limit", async () => {
    limitResult.data = [{ utm_source: "meta" }];

    const { result } = renderHook(() => useOrgUtmValues("utm_source"), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(result.current.values.length).toBe(1));

    expect(fromMock).toHaveBeenCalledWith("leads");
    expect(builder.select).toHaveBeenCalledWith("utm_source");
    expect(builder.eq).toHaveBeenCalledWith("organization_id", "org-1");
    expect(builder.not).toHaveBeenCalledWith("utm_source", "is", null);
    expect(builder.neq).toHaveBeenCalledWith("utm_source", "");
    expect(builder.limit).toHaveBeenCalledWith(1000);
  });

  it("fica desabilitado (não consulta) para campo fora da allowlist", async () => {
    const { result } = renderHook(() => useOrgUtmValues("score"), {
      wrapper: createWrapper(),
    });
    // dá tempo de um eventual fetch acontecer
    await new Promise((r) => setTimeout(r, 20));
    expect(fromMock).not.toHaveBeenCalled();
    expect(result.current.values).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it("fica desabilitado sem organizationId (org vem de useOrganization)", async () => {
    orgState.organizationId = null;
    const { result } = renderHook(() => useOrgUtmValues("utm_campaign"), {
      wrapper: createWrapper(),
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(fromMock).not.toHaveBeenCalled();
    expect(result.current.values).toEqual([]);
  });
});
