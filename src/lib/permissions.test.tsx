/**
 * Unit tests for assertPermission (imperative permission check).
 *
 * resolvePermission and useCanDo are tested in their own dedicated test files:
 *   - tests/unit/resolve-action.test.ts
 *   - tests/unit/use-can-do.test.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRpc = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

import { assertPermission } from "./permissions";

beforeEach(() => {
  mockRpc.mockReset();
});

describe("assertPermission (imperative)", () => {
  it("passes when is_user_admin returns true", async () => {
    mockRpc.mockResolvedValue({ data: true, error: null });
    await expect(assertPermission("delete_lead")).resolves.toBeUndefined();
    expect(mockRpc).toHaveBeenCalledWith("is_user_admin");
  });

  it("passes for member with feature permission", async () => {
    mockRpc
      .mockResolvedValueOnce({ data: false, error: null }) // is_user_admin
      .mockResolvedValueOnce({ data: true, error: null }); // user_has_org_permission
    await expect(assertPermission("delete_lead")).resolves.toBeUndefined();
    expect(mockRpc).toHaveBeenCalledWith("user_has_org_permission", {
      p_permission_key: "leads.delete",
    });
  });

  it("throws when member lacks feature permission", async () => {
    mockRpc
      .mockResolvedValueOnce({ data: false, error: null }) // is_user_admin
      .mockResolvedValueOnce({ data: false, error: null }); // user_has_org_permission
    await expect(assertPermission("delete_lead")).rejects.toThrow(
      "Sem permissão: leads.delete",
    );
  });

  it("throws for unknown action", async () => {
    mockRpc.mockResolvedValueOnce({ data: false, error: null });
    await expect(
      assertPermission("totally_unknown" as any),
    ).rejects.toThrow("Ação desconhecida");
  });
});
