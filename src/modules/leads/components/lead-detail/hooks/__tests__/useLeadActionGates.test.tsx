import { renderHook } from "@testing-library/react";
import { useLeadActionGates } from "../useLeadActionGates";

// ─── Mocks ──────────────────────────────────────────────────────────

// Role values mirror the real DB: team_members.role CHECK IN
// ('admin','sdr','closer','member'). "membro" is NOT a legal value — the
// original bug compared against it and denied every member. "master" is not
// a team_members.role; it surfaces via isMaster.
const roleState = vi.hoisted(() => ({
  effectiveRole: "member" as "admin" | "member" | null,
  isLoading: false,
  isMaster: false,
}));

// useLeadActionGates reads role exclusively from useIdentity().
vi.mock("@/modules/identity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/identity")>();
  return {
    ...actual,
    useIdentity: () => ({
      userId: "user-1",
      organizationId: "org-1",
      teamMemberId: "tm-1",
      effectiveRole: roleState.effectiveRole,
      isMaster: roleState.isMaster,
      isAdmin: roleState.isMaster || roleState.effectiveRole === "admin",
      features: {},
      isLoading: roleState.isLoading,
      isReady: !roleState.isLoading,
    }),
    // Mirror useCanDo's behavior using only role state.
    // Same fail-closed contract: during loading → { allowed: false, isLoading: true }.
    useCanDo: (action: string) => {
      if (roleState.isLoading) {
        return { allowed: false, reason: "loading", isLoading: true };
      }
      if (roleState.isMaster) return { allowed: true, reason: "master", isLoading: false };
      if (roleState.effectiveRole === "admin") return { allowed: true, reason: "admin", isLoading: false };
      // member defaults
      const memberDefaults: Record<string, boolean> = {
        delete_lead: false,
        move_pipe_record: true,
        create_lead: true,
        send_message: true,
        view_lead: true,
        reassign_lead: true,
        remove_lead_from_pipe: true,
      };
      const allowed = memberDefaults[action] ?? false;
      return { allowed, reason: allowed ? `feature:${action}` : `denied:${action}`, isLoading: false };
    },
  };
});

function setRole(
  role: "admin" | "member" | "master" | null,
  opts?: { loading?: boolean },
) {
  roleState.isMaster = role === "master";
  roleState.effectiveRole = role === "master" ? "admin" : (role as "admin" | "member" | null);
  roleState.isLoading = opts?.loading ?? false;
}

describe("useLeadActionGates", () => {
  describe("role: admin", () => {
    beforeEach(() => setRole("admin"));

    it("allows every gate", () => {
      const { result } = renderHook(() => useLeadActionGates("lead-1"));
      expect(result.current.canEditField.allowed).toBe(true);
      expect(result.current.canMoveMeeting.allowed).toBe(true);
      expect(result.current.canEditProposal.allowed).toBe(true);
      expect(result.current.canDelete.allowed).toBe(true);
      expect(result.current.canReassign.allowed).toBe(true);
      expect(result.current.canRemoveFromPipe.allowed).toBe(true);
      expect(result.current.canAddToPipe.allowed).toBe(true);
      expect(result.current.canManageTags.allowed).toBe(true);
      expect(result.current.canToggleAi.allowed).toBe(true);
      expect(result.current.canMention.allowed).toBe(true);
    });
  });

  describe("role: master", () => {
    beforeEach(() => setRole("master"));

    it("allows every gate (cross-org)", () => {
      const { result } = renderHook(() => useLeadActionGates("lead-1"));
      expect(result.current.canDelete.allowed).toBe(true);
      expect(result.current.canReassign.allowed).toBe(true);
      expect(result.current.canRemoveFromPipe.allowed).toBe(true);
      expect(result.current.canEditField.allowed).toBe(true);
    });
  });

  describe("role: member", () => {
    beforeEach(() => setRole("member"));

    it("allows cotidianos + reassign/remove (member herda default=true das features)", () => {
      const { result } = renderHook(() => useLeadActionGates("lead-1"));
      expect(result.current.canEditField.allowed).toBe(true);
      expect(result.current.canMoveMeeting.allowed).toBe(true);
      expect(result.current.canEditProposal.allowed).toBe(true);
      expect(result.current.canAddToPipe.allowed).toBe(true);
      expect(result.current.canManageTags.allowed).toBe(true);
      expect(result.current.canToggleAi.allowed).toBe(true);
      expect(result.current.canMention.allowed).toBe(true);
      expect(result.current.canReassign.allowed).toBe(true);
      expect(result.current.canRemoveFromPipe.allowed).toBe(true);
    });

    it("denies delete por default (feature leads.delete default=false)", () => {
      const { result } = renderHook(() => useLeadActionGates("lead-1"));
      expect(result.current.canDelete.allowed).toBe(false);
    });

    it("returns a reason on denied gates", () => {
      const { result } = renderHook(() => useLeadActionGates("lead-1"));
      expect(result.current.canDelete.reason).toBeDefined();
    });
  });

  describe("loading state — fail-closed", () => {
    beforeEach(() => setRole("admin", { loading: true }));

    it("returns allowed: false for every gate while underlying queries are loading", () => {
      const { result } = renderHook(() => useLeadActionGates("lead-1"));
      const gates = [
        result.current.canEditField,
        result.current.canMoveMeeting,
        result.current.canEditProposal,
        result.current.canDelete,
        result.current.canReassign,
        result.current.canRemoveFromPipe,
        result.current.canAddToPipe,
        result.current.canManageTags,
        result.current.canToggleAi,
        result.current.canMention,
      ];
      for (const g of gates) {
        expect(g.allowed).toBe(false);
        expect(g.isLoading).toBe(true);
      }
    });
  });

  describe("no leadId yet", () => {
    beforeEach(() => setRole("admin"));

    it("returns gates with allowed:false when leadId is null (no target)", () => {
      const { result } = renderHook(() => useLeadActionGates(null));
      expect(result.current.canDelete.allowed).toBe(false);
      expect(result.current.canEditField.allowed).toBe(false);
    });
  });
});
