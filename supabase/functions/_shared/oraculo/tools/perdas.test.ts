import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { perdasTool } from "./perdas.ts";
import type { OracleScope } from "../scope.ts";

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

function fakeDb(calls: RpcCall[], data: unknown = []) {
  return {
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return Promise.resolve({ data, error: null });
    },
  };
}

const memberScope: OracleScope = {
  kind: "assigned",
  organizationId: "org-1",
  teamMemberId: "tm-ana",
};

Deno.test("perdas — o member vê as próprias perdas, não as da organização", async () => {
  const calls: RpcCall[] = [];

  await perdasTool.execute({}, memberScope, { db: fakeDb(calls) });

  assertEquals(calls.length, 1);
  assertEquals(calls[0].args.p_organization_id, "org-1");
  assertEquals(calls[0].args.p_team_member_id, "tm-ana");
});

Deno.test("perdas — admin vê a organização; a org pedida pelo modelo é ignorada", async () => {
  const calls: RpcCall[] = [];
  const adminScope: OracleScope = {
    kind: "organization",
    organizationId: "org-1",
    teamMemberId: "tm-gestor",
  };

  await perdasTool.execute(
    { organization_id: "org-do-concorrente" },
    adminScope,
    { db: fakeDb(calls) },
  );

  assertEquals(calls[0].args.p_organization_id, "org-1");
  assertEquals(calls[0].args.p_team_member_id, null);
});

Deno.test("perdas — período e limite têm teto", async () => {
  const calls: RpcCall[] = [];
  const deps = { db: fakeDb(calls) };

  await perdasTool.execute({ periodo_dias: 9999, limite: 5000 }, memberScope, deps);
  assertEquals(calls[0].args.p_periodo_dias, 365);
  assertEquals(calls[0].args.p_limite, 50);

  await perdasTool.execute({}, memberScope, deps);
  assertEquals(calls[1].args.p_periodo_dias, 30);
  assertEquals(calls[1].args.p_limite, 20);
});
