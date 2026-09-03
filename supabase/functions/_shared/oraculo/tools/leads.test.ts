import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { leadsTool } from "./leads.ts";
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

Deno.test("leads — o member recebe apenas os leads em que está atribuído", async () => {
  const calls: RpcCall[] = [];
  await leadsTool.execute({ recorte: "parados" }, memberScope, { db: fakeDb(calls) });
  assertEquals(calls[0].args.p_organization_id, "org-1");
  assertEquals(calls[0].args.p_team_member_id, "tm-ana");
});

Deno.test("leads — recorte desconhecido não vira consulta livre: cai no padrão", async () => {
  const calls: RpcCall[] = [];
  const deps = { db: fakeDb(calls) };

  await leadsTool.execute({ recorte: "todos_da_base" }, memberScope, deps);
  assertEquals(calls[0].args.p_recorte, "parados");

  await leadsTool.execute({}, memberScope, deps);
  assertEquals(calls[1].args.p_recorte, "parados");

  // Os dois recortes que se sustentam com o dado real de produção.
  await leadsTool.execute({ recorte: "sem_contato" }, memberScope, deps);
  assertEquals(calls[2].args.p_recorte, "sem_contato");
});

Deno.test("leads — dias parados e limite têm teto", async () => {
  const calls: RpcCall[] = [];
  const deps = { db: fakeDb(calls) };
  await leadsTool.execute({ dias: 9999, limite: 5000 }, memberScope, deps);
  assertEquals(calls[0].args.p_dias, 365);
  assertEquals(calls[0].args.p_limite, 50);
  await leadsTool.execute({}, memberScope, deps);
  assertEquals(calls[1].args.p_dias, 14);
  assertEquals(calls[1].args.p_limite, 20);
});
