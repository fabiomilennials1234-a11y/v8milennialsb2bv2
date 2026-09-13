import { describe, expect, it } from "vitest";
import { isPipelineVisible, selectVisiblePipelines, sortPipelinesForNavigation } from "@/modules/pipelines/lib/pipeline-navigation";

describe("pipeline navigation state", () => {
  it("excludes hidden active seeds without changing operational data", () => {
    const rows = ["whatsapp", "confirmacao", "propostas"].map((id) => ({
      id, is_active: true, config: { navigation: { is_visible: false } },
    }));
    const leads = { id: "leads", is_active: true, config: {} };
    expect(selectVisiblePipelines([...rows, leads])).toEqual([leads]);
    expect(rows.every((row) => row.is_active)).toBe(true);
  });

  it("preserves empty organizations and accepts new funnels without metadata", () => {
    expect(selectVisiblePipelines([])).toEqual([]);
    expect(isPipelineVisible({})).toBe(true);
    expect(isPipelineVisible({ config: { navigation: { is_visible: true } } })).toBe(true);
  });

  it("sorts by canonical display_order, stays stable and follows subsequent reorder", () => {
    const rows = [
      { id: "last", display_order: 9 },
      { id: "first", display_order: 1 },
      { id: "tied", display_order: 1 },
      { id: "middle", display_order: 2 },
    ];
    const original = [...rows];
    expect(sortPipelinesForNavigation(rows).map((r) => r.id)).toEqual(["first", "tied", "middle", "last"]);
    expect(rows).toEqual(original);
    const reordered = rows.map((row) => row.id === "last" ? { ...row, display_order: -1 } : row);
    expect(sortPipelinesForNavigation(reordered).map((r) => r.id)).toEqual(["last", "first", "tied", "middle"]);
  });

  it("falls back safely when display_order is missing or non-finite", () => {
    expect(sortPipelinesForNavigation([
      { id: "invalid", display_order: Infinity }, { id: "missing" }, { id: "first", display_order: -1 },
    ]).map((r) => r.id)).toEqual(["first", "invalid", "missing"]);
  });

  it("leaves lifecycle filtering to callers and treats malformed config defensively", () => {
    const archived = { id: "archived", is_active: false, config: null };
    expect(selectVisiblePipelines([archived])).toEqual([archived]);
    for (const config of [null, [], "bad", { navigation: [] }, { navigation: null }]) {
      expect(isPipelineVisible({ config })).toBe(true);
    }
  });
});
