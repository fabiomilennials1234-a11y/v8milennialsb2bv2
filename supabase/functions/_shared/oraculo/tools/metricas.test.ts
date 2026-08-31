import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { metricasTool } from "./metricas.ts";
import type { OracleScope } from "../scope.ts";

interface RpcCall { name: string; args: Record<string, unknown> }

function fakeDb(calls: RpcCall[], data: unknown = { leads: 10 }) {
  return {
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return Promise.resolve({ data, error: null });
    },
  };
}

const memberScope: OracleScope = { kind: "assigned", organizationId: "org-1", teamMemberId: "tm-ana" };

Deno.test("metricas — o member só mede o que está atribuído a ele", async () => {
  const calls: RpcCall[] = [];

  await metricasTool.execute({ periodo_dias: 30 }, memberScope, { db: fakeDb(calls) });

  assertEquals(calls.length, 1);
  assertEquals(calls[0].args.p_organization_id, "org-1");
  assertEquals(calls[0].args.p_team_member_id, "tm-ana");
});

Deno.test("metricas — admin mede a organização inteira", async () => {
  const calls: RpcCall[] = [];
  const adminScope: OracleScope = { kind: "organization", organizationId: "org-1", teamMemberId: "tm-gestor" };

  await metricasTool.execute({}, adminScope, { db: fakeDb(calls) });

  assertEquals(calls[0].args.p_team_member_id, null);
});

Deno.test("metricas — organização pedida pelo modelo é ignorada; vale a do Escopo", async () => {
  const calls: RpcCall[] = [];

  await metricasTool.execute(
    { organization_id: "org-do-concorrente", p_organization_id: "org-do-concorrente" },
    memberScope,
    { db: fakeDb(calls) },
  );

  assertEquals(calls[0].args.p_organization_id, "org-1");
});

Deno.test("metricas — período ampliado é limitado e o ausente vira o padrão", async () => {
  const calls: RpcCall[] = [];

  await metricasTool.execute({ periodo_dias: 99999 }, memberScope, { db: fakeDb(calls) });
  await metricasTool.execute({}, memberScope, { db: fakeDb(calls) });

  assertEquals(calls[0].args.p_periodo_dias, 365);
  assertEquals(calls[1].args.p_periodo_dias, 30);
});
