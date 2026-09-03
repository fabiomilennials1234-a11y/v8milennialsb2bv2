import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { funilTool } from "./funil.ts";
import type { OracleScope } from "../scope.ts";

interface RpcCall { name: string; args: Record<string, unknown> }

function fakeDb(calls: RpcCall[], data: unknown = []) {
  return {
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return Promise.resolve({ data, error: null });
    },
  };
}

const memberScope: OracleScope = {
  kind: "assigned", organizationId: "org-1", teamMemberId: "tm-ana",
};

Deno.test("funil — o member vê o próprio funil, não o da organização", async () => {
  const calls: RpcCall[] = [];
  await funilTool.execute({}, memberScope, { db: fakeDb(calls) });
  assertEquals(calls[0].args.p_organization_id, "org-1");
  assertEquals(calls[0].args.p_team_member_id, "tm-ana");
});

Deno.test("funil — admin vê a organização; a org pedida pelo modelo é ignorada", async () => {
  const calls: RpcCall[] = [];
  const adminScope: OracleScope = {
    kind: "organization", organizationId: "org-1", teamMemberId: "tm-gestor",
  };
  await funilTool.execute({ organization_id: "org-do-concorrente" }, adminScope, { db: fakeDb(calls) });
  assertEquals(calls[0].args.p_organization_id, "org-1");
  assertEquals(calls[0].args.p_team_member_id, null);
});

Deno.test("funil — período tem teto e o ausente vira padrão", async () => {
  const calls: RpcCall[] = [];
  const deps = { db: fakeDb(calls) };
  await funilTool.execute({ periodo_dias: 9999 }, memberScope, deps);
  assertEquals(calls[0].args.p_periodo_dias, 365);
  await funilTool.execute({}, memberScope, deps);
  assertEquals(calls[1].args.p_periodo_dias, 30);
});
