import { renderHook, act } from "@testing-library/react";
import { useFunilFilters, createInitialFunilFilterState } from "./useFunilFilters";

// ── Mocks ──────────────────────────────────────────────────────────────────
vi.mock("@/modules/identity", () => ({
  useResponsibleMembers: () => [
    { id: "m-1", name: "Ana" },
    { id: "m-2", name: "Bruno" },
  ],
}));
vi.mock("@/modules/leads", () => ({
  useTags: () => ({ data: [{ id: "t-1", name: "Ouro", color: "#fc0" }] }),
}));

describe("useFunilFilters — controller plugável por pipeline_id (SCRUM-633)", () => {
  it("monta as seções universais na ordem do painel, com dicionários de dentro (contexto = só pipelineId)", () => {
    const { result } = renderHook(() => useFunilFilters("pipe-1"));
    const types = result.current.sections.map((s) => s.type);
    expect(types).toEqual([
      "created-period",
      "stalled-days",
      "responsible",
      "origin-multi",
      "tags",
      "qualification-tier",
      "pre-qualification-tier",
      "scheduled",
    ]);
    const responsible = result.current.sections.find((s) => s.type === "responsible");
    expect(responsible && "members" in responsible && responsible.members).toHaveLength(2);
    const tags = result.current.sections.find((s) => s.type === "tags");
    expect(tags && "tags" in tags && tags.tags).toEqual([
      { id: "t-1", name: "Ouro", color: "#fc0" },
    ]);
  });

  it("estado inicial: 0 filtros ativos, params neutros, leadIds sem dimensão não-suportada", () => {
    const { result } = renderHook(() => useFunilFilters("pipe-1"));
    expect(result.current.activeCount).toBe(0);
    expect(result.current.metricsRange).toBeNull();
    expect(result.current.paginatedFilters.responsibleId).toBe("all");
    expect(result.current.paginatedFilters.origins).toBeUndefined();
    expect(result.current.leadIdsUnsupportedDims).toEqual([]);
  });

  it("mudança via seção reflete em paginatedFilters E leadIdsParams (mesmo recorte nas duas RPCs)", () => {
    const { result } = renderHook(() => useFunilFilters("pipe-1"));

    act(() => {
      const origin = result.current.sections.find((s) => s.type === "origin-multi");
      if (origin && origin.type === "origin-multi") origin.onChange(["site", "meta_ads"]);
    });
    act(() => {
      const resp = result.current.sections.find((s) => s.type === "responsible");
      if (resp && resp.type === "responsible") resp.onChange("m-2");
    });

    expect(result.current.paginatedFilters.origins).toEqual(["site", "meta_ads"]);
    expect(result.current.paginatedFilters.responsibleId).toBe("m-2");
    expect(result.current.leadIdsParams.origin).toEqual(["site", "meta_ads"]);
    expect(result.current.leadIdsParams.responsibleId).toBe("m-2");
    expect(result.current.activeCount).toBe(2);
  });

  it("scheduled ativo entra no board mas é declarado como não-suportado pelo resolvedor de público", () => {
    const { result } = renderHook(() => useFunilFilters("pipe-1"));
    act(() => {
      const sec = result.current.sections.find((s) => s.type === "scheduled");
      if (sec && sec.type === "scheduled") sec.onChange(true);
    });
    expect(result.current.paginatedFilters.scheduled).toBe(true);
    expect(result.current.leadIdsUnsupportedDims).toContain("scheduled");
    expect("scheduled" in result.current.leadIdsParams).toBe(false);
  });

  it("search vive no controller e alimenta os dois blocos de params", () => {
    const { result } = renderHook(() => useFunilFilters("pipe-1"));
    act(() => result.current.setSearch("acme"));
    expect(result.current.paginatedFilters.search).toBe("acme");
    expect(result.current.leadIdsParams.search).toBe("acme");
  });

  it("clearAll volta ao estado inicial serializável", () => {
    const { result } = renderHook(() => useFunilFilters("pipe-1"));
    act(() => {
      const tags = result.current.sections.find((s) => s.type === "tags");
      if (tags && tags.type === "tags") tags.onChange(["t-1"]);
    });
    expect(result.current.activeCount).toBe(1);
    act(() => result.current.clearAll());
    expect(result.current.state).toEqual(createInitialFunilFilterState());
    expect(result.current.activeCount).toBe(0);
  });

  it("aceita estado inicial parcial (re-hidratação de saved view)", () => {
    const { result } = renderHook(() =>
      useFunilFilters("pipe-1", { initialState: { tagIds: ["t-1"], responsibleId: "m-1" } }),
    );
    expect(result.current.state.tagIds).toEqual(["t-1"]);
    expect(result.current.state.responsibleId).toBe("m-1");
    expect(result.current.activeCount).toBe(2);
  });
});
