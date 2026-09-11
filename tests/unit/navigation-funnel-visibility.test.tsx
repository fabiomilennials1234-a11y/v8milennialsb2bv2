import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { selectVisiblePipelines } from "@/modules/pipelines/lib/pipeline-navigation";

const state = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));
vi.mock("react-router-dom", () => ({ useLocation: () => ({ pathname: "/funis" }) }));
vi.mock("@/contexts/OrgFeaturesContext", () => ({ useOrgFeatures: () => ({ hasFeature: () => true }) }));
vi.mock("@/modules/identity", () => ({
  useIdentity: () => ({ isAdmin: true, isMaster: false }),
  useUserRole: () => ({ data: { role: "admin" } }),
  useFeaturePermissions: () => ({ data: {} }),
  useOrganization: () => ({ orgType: "standard" }),
}));
vi.mock("@/modules/communication/hooks/chat-meta/useMetaPages", () => ({ useMetaPages: () => ({ data: { pages: [] } }) }));
vi.mock("@/modules/pipelines", async () => ({
  ...await import("@/modules/pipelines/lib/pipeline-navigation"),
  usePipelines: () => ({ data: state.rows }),
  funilIcon: () => () => null,
  selectVisiblePipelines,
}));

import { useNavigationModel } from "@/modules/platform/hooks/useNavigationModel";

beforeEach(() => { state.rows = []; });

describe("sidebar canonical funnel visibility", () => {
  it("hides active seeds, preserves names and migrated order, and keeps archived funnels out", () => {
    state.rows = [
      ...["whatsapp", "confirmacao", "propostas"].map((slug) => ({
        id: slug, slug, name: slug, is_active: true,
        config: { navigation: { is_visible: false } },
      })),
      { id: "later", slug: "later", name: "Renamed", is_active: true, display_order: 2 },
      { id: "leads", slug: "leads", name: "Leads", is_active: true, display_order: 1 },
      { id: "archive", slug: "archive", name: "Archive", is_active: false },
    ];
    const { result } = renderHook(() => useNavigationModel());
    const children = result.current.primary.find((item) => item.path === "/funis")?.children;
    expect(children?.map(({ label, path }) => ({ label, path }))).toEqual([
      { label: "Leads", path: "/funil/leads" },
      { label: "Renamed", path: "/funil/later" },
    ]);
  });

  it("keeps ended temporary funnels out while retaining draft and paused funnels", () => {
    state.rows = ["ended", "draft", "paused"].map((status) => ({
      id: status, slug: status, name: status, is_active: true,
      config: { lifecycle_type: "temporary", status },
    }));
    const { result } = renderHook(() => useNavigationModel());
    expect(result.current.primary.find((item) => item.path === "/funis")?.children?.map((item) => item.label))
      .toEqual(["draft", "paused"]);
  });

  it("does not invent children for an empty organization", () => {
    const { result } = renderHook(() => useNavigationModel());
    expect(result.current.primary.find((item) => item.path === "/funis")?.children).toEqual([]);
  });
});
