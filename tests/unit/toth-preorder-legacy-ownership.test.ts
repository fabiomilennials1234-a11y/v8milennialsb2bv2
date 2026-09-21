import { describe, expect, it, vi } from "vitest";
import { createTothPreorderOwnershipGuard, importTothOrderUnlessOwned } from "../../supabase/functions/_shared/erp/toth-preorders/legacy-ownership";
import { TOTH_PREORDER_PILOT_ID } from "../../supabase/functions/_shared/erp/toth-preorders/rpc-client";

const owner = { id: "operation-1", deal_id: "deal-1", organization_id: TOTH_PREORDER_PILOT_ID, external_id: "123" };
const make = () => {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
  const guard = createTothPreorderOwnershipGuard({ rpc }, TOTH_PREORDER_PILOT_ID);
  const legacy = vi.fn().mockResolvedValue({ action: "created", orderId: "legacy-1" });
  return { rpc, guard, legacy };
};

describe("Toth preorder ownership bridge", () => {
  it("leaves other organizations untouched even for the same ERP number", async () => {
    const { rpc, legacy } = make();
    const guard = createTothPreorderOwnershipGuard({ rpc }, "another-org");
    await expect(importTothOrderUnlessOwned(guard, "123", legacy)).resolves.toEqual({ action: "created", orderId: "legacy-1" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("preserves historical imports and caches lookups within one sync", async () => {
    const { rpc, guard, legacy } = make();
    await importTothOrderUnlessOwned(guard, "123", legacy);
    await importTothOrderUnlessOwned(guard, "123", legacy);
    expect(legacy).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("toth_find_owned_preorder", { p_organization_id: TOTH_PREORDER_PILOT_ID, p_external_id: "123" });
  });

  it("does not import or approve a record owned by a new preorder operation", async () => {
    const { rpc, guard, legacy } = make();
    rpc.mockResolvedValue({ data: owner, error: null });
    await expect(importTothOrderUnlessOwned(guard, "123", legacy)).resolves.toEqual({ action: "skipped", reason: "owned_preorder" });
    expect(legacy).not.toHaveBeenCalled();
  });

  it.each(["PGRST202", "42883"])("keeps old deployments compatible when RPC is absent (%s)", async (code) => {
    const { rpc, guard, legacy } = make();
    rpc.mockResolvedValue({ data: null, error: { code } });
    await importTothOrderUnlessOwned(guard, "123", legacy);
    await importTothOrderUnlessOwned(guard, "456", legacy);
    expect(legacy).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledOnce();
  });

  it("fails closed on deployed-schema errors and does not leak database text", async () => {
    const { rpc, guard, legacy } = make();
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "private SQL detail" } });
    await expect(importTothOrderUnlessOwned(guard, "123", legacy)).rejects.toThrow(/^toth_preorder_ownership_unverified$/);
    expect(legacy).not.toHaveBeenCalled();
  });

  it("sanitizes transport failures before the legacy importer can run", async () => {
    const { rpc, guard, legacy } = make();
    rpc.mockRejectedValue(new Error("private database endpoint and token"));
    await expect(importTothOrderUnlessOwned(guard, "123", legacy)).rejects.toThrow(/^toth_preorder_ownership_unverified$/);
    expect(legacy).not.toHaveBeenCalled();
  });

  it.each([[], "true", {}, { ...owner, organization_id: "other" }, { ...owner, external_id: "456" }])("rejects malformed or mismatched ownership %j", async (data) => {
    const { rpc, guard, legacy } = make();
    rpc.mockResolvedValue({ data, error: null });
    await expect(importTothOrderUnlessOwned(guard, "123", legacy)).rejects.toThrow("toth_preorder_ownership_unverified");
    expect(legacy).not.toHaveBeenCalled();
  });

  it("handles binding during a legacy insert using the SQL refusal and fresh lookup", async () => {
    const { rpc, guard, legacy } = make();
    rpc.mockResolvedValueOnce({ data: null, error: null }).mockResolvedValueOnce({ data: owner, error: null });
    legacy.mockRejectedValue(new Error("createOrder: toth_preorder_owned_external_id"));
    await expect(importTothOrderUnlessOwned(guard, "123", legacy)).resolves.toEqual({ action: "skipped", reason: "owned_preorder" });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(legacy).toHaveBeenCalledOnce();
  });

  it("never masks a regular import error or an unconfirmed ownership refusal", async () => {
    const { guard, legacy } = make();
    legacy.mockRejectedValueOnce(new Error("database offline"));
    await expect(importTothOrderUnlessOwned(guard, "123", legacy)).rejects.toThrow("database offline");
    legacy.mockRejectedValueOnce(new Error("toth_preorder_owned_external_id"));
    await expect(importTothOrderUnlessOwned(guard, "123", legacy)).rejects.toThrow("toth_preorder_owned_external_id");
  });
});
