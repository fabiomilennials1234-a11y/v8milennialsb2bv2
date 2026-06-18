import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useWorkflows, useToggleWorkflow, useDeleteWorkflow } from "@/modules/workflows/hooks/useWorkflows";
import {
  Plus,
  Workflow,
  Loader2,
  Play,
  Pause,
  Trash2,
  Edit,
  Clock,
  Download,
  Zap,
  GitBranch,
  Tag,
  TrendingUp,
  Upload,
  Timer,
} from "lucide-react";
import { toast } from "sonner";
import { useFeaturePermission } from "@/modules/identity";
import { useExportWorkflow, useImportWorkflow } from "@/modules/workflows/hooks/useWorkflowPortability";
import { WorkflowImportDialog } from "@/modules/workflows/components/WorkflowImportDialog";
import { WorkflowTemplates } from "@/modules/workflows/components/WorkflowTemplates";
import { TRIGGER_LABELS } from "@/types/workflow";
import type { Workflow as WorkflowType } from "@/types/workflow";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

const TRIGGER_ICONS: Record<string, React.ElementType> = {
  lead_created: Zap,
  stage_changed: GitBranch,
  tag_added: Tag,
  score_reached: TrendingUp,
  cron: Timer,
};

export default function Automacoes() {
  const navigate = useNavigate();
  const { data: workflows, isLoading } = useWorkflows();
  const toggleWorkflow = useToggleWorkflow();
  const deleteWorkflow = useDeleteWorkflow();
  const [deleteTarget, setDeleteTarget] = useState<WorkflowType | null>(null);
  const handleExport = useExportWorkflow();
  const {
    importWorkflow,
    isImporting,
    report: importReport,
    isOpen: isImportOpen,
    openImport,
    closeImport,
  } = useImportWorkflow();
  const { allowed: canCreateAutomation } = useFeaturePermission("workflows.create");
  const { allowed: canEditAutomation } = useFeaturePermission("workflows.edit");
  const { allowed: canDeleteAutomation } = useFeaturePermission("workflows.delete");

  const activeWorkflows = workflows?.filter((w) => w.is_active) || [];
  const inactiveWorkflows = workflows?.filter((w) => !w.is_active) || [];

  const handleToggle = (workflow: WorkflowType) => {
    toggleWorkflow.mutate(
      { id: workflow.id, is_active: !workflow.is_active },
      {
        onSuccess: () => {
          toast.success(workflow.is_active ? "Workflow desativado" : "Workflow ativado");
        },
        onError: () => toast.error("Erro ao alterar status"),
      }
    );
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    deleteWorkflow.mutate(deleteTarget.id, {
      onSuccess: () => {
        toast.success("Workflow excluído");
        setDeleteTarget(null);
      },
      onError: () => toast.error("Erro ao excluir workflow"),
    });
  };

  const renderWorkflowCard = (workflow: WorkflowType) => {
    const TriggerIcon = TRIGGER_ICONS[workflow.trigger_type] || Zap;
    const nodeCount = workflow.definition?.nodes?.length ?? 0;

    return (
      <Card
        key={workflow.id}
        className="group hover:shadow-md transition-shadow cursor-pointer"
        onClick={() => navigate(`/automacoes/${workflow.id}`)}
      >
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className="p-2 rounded-lg bg-primary/10 text-primary">
                <TriggerIcon className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1">
                <CardTitle className="text-base truncate">{workflow.name}</CardTitle>
                {workflow.description && (
                  <p className="text-sm text-muted-foreground truncate mt-0.5">
                    {workflow.description}
                  </p>
                )}
              </div>
            </div>
            <div
              className="flex items-center gap-2"
              onClick={(e) => e.stopPropagation()}
            >
              <Switch
                checked={workflow.is_active}
                onCheckedChange={() => handleToggle(workflow)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-3 text-muted-foreground">
              <Badge variant="secondary" className="font-normal">
                {TRIGGER_LABELS[workflow.trigger_type]}
              </Badge>
              <span>{nodeCount} nós</span>
            </div>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                disabled={!canEditAutomation}
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(`/automacoes/${workflow.id}`);
                }}
              >
                <Edit className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={(e) => {
                  e.stopPropagation();
                  handleExport(workflow);
                }}
                title="Exportar workflow"
              >
                <Download className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive hover:text-destructive"
                disabled={!canDeleteAutomation}
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteTarget(workflow);
                }}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>
          <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              Criado {formatDistanceToNow(new Date(workflow.created_at), { addSuffix: true, locale: ptBR })}
            </span>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">
            Automações
          </h1>
          <p className="text-muted-foreground">
            Crie e gerencie workflows visuais para automatizar ações no CRM
          </p>
        </div>
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-0 [&>*]:shrink-0">
          <Button variant="outline" onClick={openImport} disabled={!canCreateAutomation}>
            <Upload className="w-4 h-4 mr-2" />
            Importar
          </Button>
          <Button onClick={() => navigate("/automacoes/novo")} disabled={!canCreateAutomation}>
            <Plus className="w-4 h-4 mr-2" />
            Novo Workflow
          </Button>
        </div>
      </div>

      {/* Templates */}
      <WorkflowTemplates />

      <Separator className="my-6" />

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : !workflows?.length ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="p-4 rounded-full bg-primary/10 mb-4">
              <Workflow className="w-8 h-8 text-primary" />
            </div>
            <h3 className="text-lg font-semibold mb-1">Nenhum workflow criado</h3>
            <p className="text-muted-foreground mb-4 max-w-md">
              Crie seu primeiro workflow visual para automatizar ações como enviar mensagens,
              mover leads e mais.
            </p>
            <Button onClick={() => navigate("/automacoes/novo")} disabled={!canCreateAutomation}>
              <Plus className="w-4 h-4 mr-2" />
              Criar Primeiro Workflow
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Active */}
          {activeWorkflows.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Play className="w-4 h-4 text-green-500" />
                Ativos ({activeWorkflows.length})
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {activeWorkflows.map(renderWorkflowCard)}
              </div>
            </div>
          )}

          {/* Inactive */}
          {inactiveWorkflows.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold flex items-center gap-2 text-muted-foreground">
                <Pause className="w-4 h-4" />
                Inativos ({inactiveWorkflows.length})
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {inactiveWorkflows.map(renderWorkflowCard)}
              </div>
            </div>
          )}
        </>
      )}

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir workflow</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir "{deleteTarget?.name}"? Esta ação não pode ser desfeita.
              Todas as execuções associadas também serão removidas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Import Dialog */}
      <WorkflowImportDialog
        open={isImportOpen}
        onClose={closeImport}
        onImport={(json) => importWorkflow(json)}
        isImporting={isImporting}
        report={importReport}
      />
    </div>
  );
}
