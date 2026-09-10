import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { benchmarkTool } from "./benchmark.ts";
import type { OracleScope } from "../scope.ts";

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

Deno.test("benchmark — membro é recusado antes de consultar agregados da organização", async () => {
  const calls: RpcCall[] = [];
  const scope: OracleScope = {
    kind: "assigned",
    organizationId: "org-1",
    teamMemberId: "tm-1",
  };

  const result = await benchmarkTool.execute({}, scope, { db: fakeDb(calls) });

  assertEquals(result, { error: "fora_do_escopo" });
  assertEquals(calls, []);
});

Deno.test("benchmark — organização sempre vem do escopo autenticado", async () => {
  const calls: RpcCall[] = [];
  const scope: OracleScope = {
    kind: "organization",
    organizationId: "org-correta",
    teamMemberId: "tm-admin",
  };

  await benchmarkTool.execute(
    { organization_id: "org-alheia", p_organization_id: "org-alheia" },
    scope,
    { db: fakeDb(calls, { external_benchmark: {} }) },
  );

  assertEquals(calls, [{
    name: "oraculo_benchmark",
    args: { p_organization_id: "org-correta" },
  }]);
});

Deno.test("benchmark — falha de banco vira erro opaco", async () => {
  const scope: OracleScope = {
    kind: "organization",
    organizationId: "org-1",
    teamMemberId: "tm-admin",
  };
  const db = {
    rpc: () => Promise.resolve({ data: null, error: { message: "detalhe interno" } }),
  };

  assertEquals(
    await benchmarkTool.execute({}, scope, { db }),
    { error: "consulta_falhou" },
  );
});
