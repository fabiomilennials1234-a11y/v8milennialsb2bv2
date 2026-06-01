import { useState } from "react";
import { X, Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useAllOrganizations,
  useOrgWorkflows,
  useCreateAutomationTemplate,
} from "@/modules/platform/hooks/useOnboardingTemplates";
import { toast } from "sonner";

interface Props {
  onClose: () => void;
}

export function ImportWorkflowDialog({ onClose }: Props) {
  const { data: orgs, isLoading: orgsLoading } = useAllOrganizations();
  const [selectedOrg, setSelectedOrg] = useState<string | null>(null);
  const { data: workflows, isLoading: wfLoading } = useOrgWorkflows(selectedOrg);
  const createMutation = useCreateAutomationTemplate();

  const handleImport = async (wf: any) => {
    try {
      await createMutation.mutateAsync({
        name: `[Importado] ${wf.name}`,
        description: `Importado de org workflow. Original: ${wf.name}`,
        type: "custom",
        trigger_type: wf.trigger_type ?? "manual",
        trigger_config: wf.trigger_config ?? {},
        workflow_definition: wf.definition ?? {},
        customizable_fields: [],
        match_criteria: null,
        is_active: false,
      });
      toast.success(`Workflow "${wf.name}" importado como template`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao importar");
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-lg max-h-[80vh] overflow-y-auto p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Importar Workflow</h3>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        <p className="text-sm text-muted-foreground">
          Selecione uma org e importe um workflow existente como template de automação.
        </p>

        <div>
          <Label>Organização</Label>
          {orgsLoading ? (
            <p className="text-xs text-muted-foreground mt-1">Carregando orgs...</p>
          ) : (
            <Select value={selectedOrg ?? ""} onValueChange={setSelectedOrg}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione uma org" />
              </SelectTrigger>
              <SelectContent>
                {(orgs ?? []).map((org: any) => (
                  <SelectItem key={org.id} value={org.id}>
                    {org.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {selectedOrg && (
          <div className="space-y-2">
            <Label>Workflows ({workflows?.length ?? 0})</Label>
            {wfLoading && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="w-3 h-3 animate-spin" /> Carregando...
              </div>
            )}
            {(workflows ?? []).map((wf: any) => (
              <div
                key={wf.id}
                className="p-3 rounded-lg border border-border/40 flex items-center justify-between"
              >
                <div>
                  <span className="text-sm font-medium">{wf.name}</span>
                  <div className="flex gap-1 mt-0.5">
                    <span className="text-[10px] text-muted-foreground">{wf.trigger_type}</span>
                    {wf.is_active && (
                      <span className="text-[10px] text-green-500">ativo</span>
                    )}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleImport(wf)}
                  disabled={createMutation.isPending}
                >
                  <Download className="w-3.5 h-3.5 mr-1" />
                  Importar
                </Button>
              </div>
            ))}
            {!wfLoading && workflows?.length === 0 && (
              <p className="text-xs text-muted-foreground">Nenhum workflow encontrado.</p>
            )}
          </div>
        )}

        <div className="flex justify-end pt-2 border-t border-border/40">
          <Button variant="outline" onClick={onClose}>Fechar</Button>
        </div>
      </div>
    </div>
  );
}
