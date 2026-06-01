import { useState } from "react";
import { Plus, Pencil, Trash2, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { usePipelineTemplates, useDeletePipelineTemplate } from "@/modules/platform/hooks/useOnboardingTemplates";
import { PipelineTemplateEditor } from "./PipelineTemplateEditor";
import { toast } from "sonner";

export function PipelineTemplatesTab() {
  const { data: templates, isLoading } = usePipelineTemplates();
  const deleteMutation = useDeletePipelineTemplate();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

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
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="w-4 h-4 mr-1" /> Novo Template
        </Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}

      <div className="space-y-2">
        {(templates ?? []).map((tpl: any) => (
          <div
            key={tpl.id}
            className="p-4 rounded-xl border border-border/60 bg-card flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: tpl.color ?? "#888" }}
              />
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{tpl.name}</span>
                  <Badge variant="outline" className="text-[10px]">P{tpl.priority}</Badge>
                  {!tpl.is_active && <Badge variant="destructive" className="text-[10px]">Inativo</Badge>}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{tpl.description}</p>
                {tpl.custom_pipelines?.length > 0 && (
                  <div className="flex gap-1 mt-1">
                    {(tpl.custom_pipelines as any[]).map((cp: any, i: number) => (
                      <Badge key={i} variant="secondary" className="text-[10px]">
                        {cp.name} ({cp.stages?.length ?? 0} stages)
                      </Badge>
                    ))}
                  </div>
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
        <PipelineTemplateEditor
          templateId={editingId}
          onClose={() => { setEditingId(null); setCreating(false); }}
        />
      )}
    </div>
  );
}
