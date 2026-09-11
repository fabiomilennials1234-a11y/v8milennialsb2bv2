import { describe, expect, it } from "vitest";
import { createMockSupabase } from "../helpers/supabase-mock";
import { resolveWorkflowTriggerScope } from "../../supabase/functions/_shared/workflow-trigger-scope";

describe("workflow trigger tenant scope", () => {
  const fixture = () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable("team_members", [{ user_id: "user", organization_id: "own", is_active: true }, { user_id: "inactive", organization_id: "own", is_active: false }]);
    mockTable("leads", [{ id: "lead", organization_id: "own" }, { id: "foreign-lead", organization_id: "foreign" }]);
    return sb;
  };
  it("allows an active member to trigger an own-tenant lead", async () => expect(await resolveWorkflowTriggerScope(fixture(), "user", "own", "lead")).toBe("own"));
  it("rejects a caller-supplied foreign organization", async () => expect(await resolveWorkflowTriggerScope(fixture(), "user", "foreign", "foreign-lead")).toBeNull());
  it("rejects a foreign lead even with the caller's org", async () => expect(await resolveWorkflowTriggerScope(fixture(), "user", "own", "foreign-lead")).toBeNull());
  it("rejects inactive members", async () => expect(await resolveWorkflowTriggerScope(fixture(), "inactive", "own", "lead")).toBeNull());
  it("also checks cron lead tenancy", async () => expect(await resolveWorkflowTriggerScope(fixture(), null, "own", "foreign-lead")).toBeNull());
});
