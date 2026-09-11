import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createWrapper } from "../../../../../tests/helpers/hook-test-utils";
import { useOrgConditionValues } from "../useOrgConditionValues";

const state = vi.hoisted(() => ({ org: "org-1" as string | null }));
const db = vi.hoisted(() => ({ from: vi.fn(), select: vi.fn(), eq: vi.fn(), not: vi.fn(), neq: vi.fn(), limit: vi.fn() }));
vi.mock("@/modules/identity", () => ({ useOrganization: () => ({ organizationId: state.org, isReady: !!state.org }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: db.from } }));
beforeEach(() => {
  vi.clearAllMocks(); state.org = "org-1";
  for (const method of [db.from, db.select, db.eq, db.not, db.neq]) method.mockReturnValue(db);
  db.limit.mockResolvedValue({ data: [{ segment: "Indústria" }, { segment: "Indústria" }, { segment: "" }], error: null });
});
describe("condition suggestions", () => {
  it("scopes suggestions to the organization and deduplicates", async () => {
    const { result } = renderHook(() => useOrgConditionValues("segment"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.values).toEqual(["Indústria"]));
    expect(db.eq).toHaveBeenCalledWith("organization_id", "org-1");
    expect(db.select).toHaveBeenCalledWith("segment");
  });
  it.each(["email", "custom.secret", "segment,organization_id", undefined])("does not query arbitrary field %s", (field) => {
    renderHook(() => useOrgConditionValues(field), { wrapper: createWrapper() });
    expect(db.from).not.toHaveBeenCalled();
  });
  it("does not query without an organization", () => {
    state.org = null;
    renderHook(() => useOrgConditionValues("urgency"), { wrapper: createWrapper() });
    expect(db.from).not.toHaveBeenCalled();
  });
  it("does not reuse another organization's suggestions after switching", async () => {
    const { result, rerender } = renderHook(() => useOrgConditionValues("segment"), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.values).toEqual(["Indústria"]));
    state.org = "org-2";
    db.limit.mockResolvedValue({ data: [{ segment: "Serviços" }], error: null });
    rerender();
    expect(result.current.values).not.toContain("Indústria");
    await waitFor(() => expect(result.current.values).toEqual(["Serviços"]));
    expect(db.eq).toHaveBeenCalledWith("organization_id", "org-2");
  });
});
