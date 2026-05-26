import { useState } from "react";
import { Plus, Pencil, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  useAutomationTemplates,
  useDeleteAutomationTemplate,
} from "@/hooks/useOnboardingTemplates";
import { AutomationTemplateEditor } from "./AutomationTemplateEditor";
import { ImportWorkflowDialog } from "./ImportWorkflowDialog";
import { toast } from "sonner";

export function AutomationTemplatesTab() {
  const { data: templates, isLoading } = useAutomationTemplates();
  const deleteMutation = useDeleteAutomationTemplate();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);

  const handleDelete = async (id: string) => {
    try {
      await deleteMutation.mutateAsync(id);
      toast.success("Template removido");
    } catch {
      toast.error("Erro ao remover template");
    }
  };

  return (
    <div className="space-y-4 mt-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          {templates?.length ?? 0} templates
        </h3>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setImporting(true)}>
            <Upload className="w-4 h-4 mr-1" /> Importar
          </Button>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="w-4 h-4 mr-1" /> Novo Template
          </Button>
        </div>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}

      <div className="space-y-2">
        {(templates ?? []).map((tpl: any) => (
          <div
            key={tpl.id}
            className="p-4 rounded-xl border border-border/60 bg-card flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{tpl.name}</span>
                  <Badge variant="outline" className="text-[10px]">{tpl.type}</Badge>
                  <Badge variant="secondary" className="text-[10px]">{tpl.trigger_type}</Badge>
                  {!tpl.is_active && (
                    <Badge variant="destructive" className="text-[10px]">Inativo</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{tpl.description}</p>
                {tpl.customizable_fields?.length > 0 && (
                  <p className="text-[10px] text-muted-foreground/70">
                    {tpl.customizable_fields.length} campo(s) customizável(is)
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" onClick={() => setEditingId(tpl.id)}>
                <Pencil className="w-3.5 h-3.5" />
              </Button>
              <Button variant="ghost" size="icon" onClick={() => handleDelete(tpl.id)}>
                <Trash2 className="w-3.5 h-3.5 text-destructive" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      {(creating || editingId) && (
        <AutomationTemplateEditor
          templateId={editingId}
          onClose={() => {
            setEditingId(null);
            setCreating(false);
          }}
        />
      )}

      {importing && <ImportWorkflowDialog onClose={() => setImporting(false)} />}
    </div>
  );
}
