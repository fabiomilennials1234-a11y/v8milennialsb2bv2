import { renderHook } from "@testing-library/react";
import { useLeadActionGates } from "../useLeadActionGates";

// ─── Mocks ──────────────────────────────────────────────────────────

const roleState = vi.hoisted(() => ({
  role: "membro" as "admin" | "membro" | "master" | null,
  isLoading: false,
  isMaster: false,
}));

vi.mock("@/hooks/useUserRole", () => ({
  useUserRole: () => ({
    data: roleState.role ? { role: roleState.role } : null,
    isLoading: roleState.isLoading,
  }),
}));

vi.mock("@/hooks/useMasterAuth", () => ({
  useMasterAuth: () => ({
    isMaster: roleState.isMaster,
    isLoading: roleState.isLoading,
  }),
}));

// Mirror useCanPerformAction's behavior using only role state.
// Same fail-closed contract: during loading return { allowed: false, isLoading: true }.
vi.mock("@/lib/permissions", () => ({
  useCanPerformAction: (action: string) => {
    if (roleState.isLoading) {
      return { allowed: false, isLoading: true };
    }
    if (roleState.isMaster) return { allowed: true, isLoading: false };
    if (roleState.role === "admin") return { allowed: true, isLoading: false };
    // membro defaults
    const memberDefaults: Record<string, boolean> = {
      delete_lead: false,
      move_pipe_record: true,
      create_lead: true,
      send_message: true,
      view_lead: true,
    };
    return { allowed: memberDefaults[action] ?? false, isLoading: false };
  },
}));

function setRole(role: "admin" | "membro" | "master" | null, opts?: { loading?: boolean }) {
  roleState.role = role;
  roleState.isLoading = opts?.loading ?? false;
  roleState.isMaster = role === "master";
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

  describe("role: membro", () => {
    beforeEach(() => setRole("membro"));

    it("allows cotidianos (edit field, move meeting/proposal, add to pipe, tags, AI, mention)", () => {
      const { result } = renderHook(() => useLeadActionGates("lead-1"));
      expect(result.current.canEditField.allowed).toBe(true);
      expect(result.current.canMoveMeeting.allowed).toBe(true);
      expect(result.current.canEditProposal.allowed).toBe(true);
      expect(result.current.canAddToPipe.allowed).toBe(true);
      expect(result.current.canManageTags.allowed).toBe(true);
      expect(result.current.canToggleAi.allowed).toBe(true);
      expect(result.current.canMention.allowed).toBe(true);
    });

    it("denies destrutivos (delete lead, reassign, remove from pipe)", () => {
      const { result } = renderHook(() => useLeadActionGates("lead-1"));
      expect(result.current.canDelete.allowed).toBe(false);
      expect(result.current.canReassign.allowed).toBe(false);
      expect(result.current.canRemoveFromPipe.allowed).toBe(false);
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
