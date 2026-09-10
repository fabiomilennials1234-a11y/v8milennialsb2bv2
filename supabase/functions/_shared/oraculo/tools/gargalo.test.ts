import { assertEquals } from "jsr:@std/assert@^1.0.0";
import type { OracleScope } from "../scope.ts";
import { gargaloTool } from "./gargalo.ts";

Deno.test("gargalo — usa somente organização e pessoa resolvidas pelo servidor", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const scope: OracleScope = {
    kind: "assigned",
    organizationId: "10000000-0000-4000-8000-000000000001",
    teamMemberId: "20000000-0000-4000-8000-000000000001",
  };

  const result = await gargaloTool.execute(
    {
      organization_id: "30000000-0000-4000-8000-000000000001",
      team_member_id: "40000000-0000-4000-8000-000000000001",
    },
    scope,
    {
      db: {
        rpc: (name: string, args: Record<string, unknown>) => {
          calls.push({ name, args });
          return Promise.resolve({ data: { status: "none" }, error: null });
        },
      },
    },
  );

  assertEquals(calls, [{
    name: "oraculo_revenue_bottleneck",
    args: {
      p_organization_id: scope.organizationId,
      p_team_member_id: scope.teamMemberId,
    },
  }]);
  assertEquals(result, { status: "none" });
});
