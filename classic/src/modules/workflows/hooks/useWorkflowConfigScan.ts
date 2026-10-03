/**
 * Varredura de configuração dos workflows ATIVOS — /master/automation-health.
 *
 * O julgamento roda AQUI, no cliente, com as mesmas funções que o editor usa
 * (`@/contracts/workflows/node-requirements`). A RPC devolve só matéria-prima.
 * Replicar as regras em SQL criaria a divergência que este trabalho existe para
 * evitar — e uma varredura que discorda do gate é pior que varredura nenhuma.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  findNodeConfigIssues,
  findStageIssues,
  type NodeConfigIssue,
} from "@/contracts/workflows/node-requirements";

interface ScanRow {
  workflow_id: string;
  workflow_name: string;
  organization_id: string;
  organization_name: string;
  nodes: unknown;
  stage_keys: unknown;
}

export interface WorkflowConfigProblem extends NodeConfigIssue {
  workflowId: string;
  workflowName: string;
  organizationName: string;
  /** Campo vazio desde a autoria, ou referência que apodreceu depois. */
  kind: "vazio" | "podre";
}

type RpcClient = {
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
};

export function useWorkflowConfigScan() {
  return useQuery({
    queryKey: ["workflow-config-scan"],
    queryFn: async (): Promise<WorkflowConfigProblem[]> => {
      const { data, error } = await (supabase as unknown as RpcClient).rpc("master_workflow_config_scan");
      if (error) throw new Error(error.message);

      const linhas = (data ?? []) as ScanRow[];
      const problemas: WorkflowConfigProblem[] = [];

      for (const linha of linhas) {
        const nodes = Array.isArray(linha.nodes) ? (linha.nodes as { id: string; data?: Record<string, unknown> }[]) : [];
        const etapas = (linha.stage_keys ?? {}) as Record<string, string[]>;

        const marcar = (issues: NodeConfigIssue[], kind: WorkflowConfigProblem["kind"]) => {
          for (const i of issues) {
            problemas.push({
              ...i,
              kind,
              workflowId: linha.workflow_id,
              workflowName: linha.workflow_name,
              organizationName: linha.organization_name,
            });
          }
        };

        marcar(findNodeConfigIssues(nodes), "vazio");
        marcar(findStageIssues(nodes, etapas), "podre");
      }

      // Referência podre primeiro: é a que o gate de ativação NUNCA vai pegar.
      return problemas.sort((a, b) =>
        a.kind === b.kind
          ? a.organizationName.localeCompare(b.organizationName)
          : a.kind === "podre" ? -1 : 1,
      );
    },
    refetchInterval: 5 * 60_000,
  });
}
