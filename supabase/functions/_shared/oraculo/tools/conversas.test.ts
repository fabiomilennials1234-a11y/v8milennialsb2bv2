import { assertEquals } from "jsr:@std/assert@^1.0.0";
import type { OracleScope } from "../scope.ts";
import { conversasTool } from "./conversas.ts";

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

function fakeDb(calls: RpcCall[], data: unknown = {}) {
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

Deno.test("conversas — escopo assigned chega à RPC sem vir do modelo", async () => {
  const calls: RpcCall[] = [];
  await conversasTool.execute({ periodo_dias: 9999, limite: 5000 }, memberScope, {
    db: fakeDb(calls),
  });
  assertEquals(calls, [{
    name: "oraculo_conversas",
    args: {
      p_organization_id: "org-1",
      p_team_member_id: "tm-ana",
      p_periodo_dias: 365,
      p_limite: 50,
    },
  }]);
});

Deno.test("conversas — falha do banco não vaza detalhe", async () => {
  const db = { rpc: () => Promise.resolve({ data: null, error: { message: "segredo SQL" } }) };
  assertEquals(await conversasTool.execute({}, memberScope, { db }), { error: "consulta_falhou" });
});

Deno.test("conversas — view_org_metrics não amplia acesso a chats", async () => {
  const calls: RpcCall[] = [];
  await conversasTool.execute({}, {
    kind: "organization",
    organizationId: "org-1",
    teamMemberId: "tm-ana",
    chatTeamMemberId: "tm-ana",
  }, { db: fakeDb(calls) });
  assertEquals(calls[0].args.p_team_member_id, "tm-ana");
});
