// src/hooks/useWorkflowPortability.ts

import { useCallback, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toast } from "sonner";
import { assertPermission, useOrganization } from "@/modules/identity";
import { supabase } from "@/integrations/supabase/client";
import { useCreateWorkflow } from "@/modules/workflows/hooks/useWorkflows";
import {
  exportWorkflow,
  downloadWorkflowJson,
  parseWorkflowFile,
  prepareImport,
} from "@/lib/workflowPortability";
import type { Workflow } from "@/types/workflow";
import type { ImportReport } from "@/types/workflowPortability";

const database: SupabaseClient = supabase;

export function useExportWorkflow() {
  const { organizationId } = useOrganization();
  return useCallback(
    async (workflow: Workflow, currentDefinition?: Workflow["definition"]) => {
      try {
        let source = currentDefinition ? { ...workflow, definition: currentDefinition } : workflow;
        if (!currentDefinition && organizationId) {
          const draft = await database.from("workflow_guided_drafts").select("definition, settings")
            .eq("organization_id", organizationId).eq("workflow_id", workflow.id)
            .returns<Array<{ definition: Workflow["definition"]; settings: unknown }>>().maybeSingle();
          if (draft.error) throw draft.error;
          if (draft.data) {
            const settings = draft.data.settings && typeof draft.data.settings === "object" && !Array.isArray(draft.data.settings)
              ? draft.data.settings as Record<string, unknown> : {};
            source = { ...workflow,
              name: typeof settings.name === "string" ? settings.name : workflow.name,
              definition: draft.data.definition as unknown as Workflow["definition"],
            };
          }
        }
        const file = exportWorkflow(source);
        const safeName = source.name.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
        const filename = `workflow_${safeName}_${Date.now()}.json`;
        downloadWorkflowJson(file, filename);
        toast.success("Workflow exportado com sucesso!");
      } catch (err: any) {
        toast.error(err.message || "Erro ao exportar workflow");
      }
    },
    [organizationId],
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

      // 3. Guided trees need the separated publication boundary. Legacy files
      // keep the established inactive import path.
      if (!organizationId) throw new Error("Sem organização");
      if (report.mode === "legacy_inactive") {
        const legacy = await createWorkflow.mutateAsync(workflowInsert);
        report.workflowId = legacy.id;
        return report;
      }
      await assertPermission("create_workflow");
      const workflowId = crypto.randomUUID();
      const result = await database.rpc("create_guided_workflow_draft_with_settings", {
        p_workflow_id: workflowId,
        p_organization_id: organizationId,
        p_definition: workflowInsert.definition,
        p_settings: {
          name: workflowInsert.name,
          enrollment_criteria: { enabled: false, match_all: true, conditions: [] },
          re_enrollment_enabled: false,
          re_enrollment_cooldown_days: 30,
          re_enrollment_max_times: 1,
        },
      });
      if (result.error) throw result.error;
      report.workflowId = workflowId;

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
