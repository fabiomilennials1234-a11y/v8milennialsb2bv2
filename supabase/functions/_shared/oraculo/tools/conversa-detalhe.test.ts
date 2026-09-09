import { assertEquals } from "jsr:@std/assert@^1.0.0";
import type { OracleScope } from "../scope.ts";
import { conversaDetalheTool } from "./conversa-detalhe.ts";

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

Deno.test("conversa_detalhe — identificadores e escopo são separados", async () => {
  const calls: RpcCall[] = [];
  await conversaDetalheTool.execute(
    {
      lead_id: "11111111-1111-4111-8111-111111111111",
      instance_id: "22222222-2222-4222-8222-222222222222",
      limite: 9999,
    },
    memberScope,
    { db: fakeDb(calls) },
  );
  assertEquals(calls[0], {
    name: "oraculo_conversa_detalhe",
    args: {
      p_organization_id: "org-1",
      p_team_member_id: "tm-ana",
      p_lead_id: "11111111-1111-4111-8111-111111111111",
      p_instance_id: "22222222-2222-4222-8222-222222222222",
      p_limite: 200,
    },
  });
});

Deno.test("conversa_detalhe — UUID inválido não toca no banco", async () => {
  const calls: RpcCall[] = [];
  assertEquals(
    await conversaDetalheTool.execute(
      { lead_id: "não-é-uuid", instance_id: "também-não" },
      memberScope,
      { db: fakeDb(calls) },
    ),
    { error: "identificador_invalido" },
  );
  assertEquals(calls, []);
});
