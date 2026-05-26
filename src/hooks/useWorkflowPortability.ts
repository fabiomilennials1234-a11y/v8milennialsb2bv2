// src/hooks/useWorkflowPortability.ts

import { useCallback, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useOrganization } from "@/modules/identity";
import { useCreateWorkflow } from "@/hooks/useWorkflows";
import {
  exportWorkflow,
  downloadWorkflowJson,
  parseWorkflowFile,
  prepareImport,
} from "@/lib/workflowPortability";
import type { Workflow } from "@/types/workflow";
import type { ImportReport } from "@/types/workflowPortability";

export function useExportWorkflow() {
  return useCallback(
    (workflow: Workflow) => {
      try {
        const file = exportWorkflow(workflow);
        const safeName = workflow.name.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
        const filename = `workflow_${safeName}_${Date.now()}.json`;
        downloadWorkflowJson(file, filename);
        toast.success("Workflow exportado com sucesso!");
      } catch (err: any) {
        toast.error(err.message || "Erro ao exportar workflow");
      }
    },
    [],
  );
}

export function useImportWorkflow() {
  const createWorkflow = useCreateWorkflow();
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();
  const [report, setReport] = useState<ImportReport | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const importMutation = useMutation({
    mutationFn: async (jsonString: string): Promise<ImportReport> => {
      // 1. Parse and validate
      const { data: file, error: parseError } = parseWorkflowFile(jsonString);
      if (!file || parseError) {
        throw new Error(parseError || "Arquivo inválido");
      }

      // 2. Prepare import (remap IDs, build report)
      const { workflowInsert, report } = prepareImport(file);

      // 3. Create in database
      const result = await createWorkflow.mutateAsync(workflowInsert);
      report.workflowId = result.id;

      return report;
    },
    onSuccess: (report) => {
      setReport(report);
      queryClient.invalidateQueries({ queryKey: ["workflows", organizationId] });
    },
    onError: (err: any) => {
      toast.error(err.message || "Erro ao importar workflow");
    },
  });

  const openImport = useCallback(() => setIsOpen(true), []);
  const closeImport = useCallback(() => {
    setIsOpen(false);
    setReport(null);
  }, []);

  return {
    importWorkflow: importMutation.mutate,
    importWorkflowAsync: importMutation.mutateAsync,
    isImporting: importMutation.isPending,
    report,
    setReport,
    isOpen,
    openImport,
    closeImport,
  };
}
