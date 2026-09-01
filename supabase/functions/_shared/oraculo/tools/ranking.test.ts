import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { rankingTool } from "./ranking.ts";
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

Deno.test("ranking — member é recusado ANTES de tocar no banco", async () => {
  const calls: RpcCall[] = [];

  const saida = await rankingTool.execute({}, memberScope, { db: fakeDb(calls) });

  // A recusa não pode ser um filtro aplicado depois: comparar colegas é
  // justamente o que o Escopo `assigned` não alcança. Se a consulta sair, o
  // dado já saiu do banco.
  assertEquals(calls.length, 0);
  assertEquals(saida, { error: "fora_do_escopo" });
});

Deno.test("ranking — admin consulta, e a organização vem do Escopo, não do modelo", async () => {
  const calls: RpcCall[] = [];
  const adminScope: OracleScope = {
    kind: "organization",
    organizationId: "org-1",
    teamMemberId: "tm-gestor",
  };

  await rankingTool.execute(
    { organization_id: "org-do-concorrente", p_organization_id: "org-do-concorrente" },
    adminScope,
    { db: fakeDb(calls) },
  );

  assertEquals(calls.length, 1);
  assertEquals(calls[0].args.p_organization_id, "org-1");
});

Deno.test("ranking — pergunta ampla não puxa a base inteira: período e limite têm teto", async () => {
  const calls: RpcCall[] = [];
  const adminScope: OracleScope = {
    kind: "organization",
    organizationId: "org-1",
    teamMemberId: "tm-gestor",
  };
  const deps = { db: fakeDb(calls) };

  await rankingTool.execute({ periodo_dias: 9999, limite: 5000 }, adminScope, deps);
  assertEquals(calls[0].args.p_periodo_dias, 365);
  assertEquals(calls[0].args.p_limite, 50);

  // Ausente e lixo caem no padrão, nunca em "sem limite".
  await rankingTool.execute({}, adminScope, deps);
  assertEquals(calls[1].args.p_periodo_dias, 30);
  assertEquals(calls[1].args.p_limite, 20);

  await rankingTool.execute({ periodo_dias: "muitos", limite: -1 }, adminScope, deps);
  assertEquals(calls[2].args.p_periodo_dias, 30);
  assertEquals(calls[2].args.p_limite, 20);
});
