/** Benchmark agregado. A conversa lê snapshot; nunca percorre organizações. */

import type { OracleScope } from "../scope.ts";
import type { ToolDeps } from "./metricas.ts";

export const BENCHMARK_RPC = "oraculo_benchmark";

export const benchmarkTool = {
  name: "benchmark",

  async execute(
    _args: Record<string, unknown>,
    scope: OracleScope,
    deps: ToolDeps,
  ): Promise<unknown> {
    if (scope.kind !== "organization") return { error: "fora_do_escopo" };

    const { data, error } = await deps.db.rpc(BENCHMARK_RPC, {
      p_organization_id: scope.organizationId,
    });

    if (error) return { error: "consulta_falhou" };
    return data;
  },
};
