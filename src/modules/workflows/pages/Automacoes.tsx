import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/ui/page-header";
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
import { TRIGGER_LABELS, isDiscontinuedTrigger } from "@/types/workflow";
import { DiscontinuedBadge } from "@/modules/workflows/components/DiscontinuedNotice";
import { countDiscontinuedSteps } from "@/modules/workflows/lib/discontinued-steps";
import { cn } from "@/lib/utils";
import type { Workflow as WorkflowType } from "@/types/workflow";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

const TRIGGER_ICONS: Record<string, React.ElementType> = {
  lead_created: Zap,
  stage_changed: GitBranch,
  tag_added: Tag,
  score_reached: TrendingUp, // descontinuado — mantido para listar workflow salvo
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
        onError: (err: unknown) =>
          toast.error(
            err instanceof Error && err.message ? err.message : "Erro ao alterar status",
            { duration: 8000 },
          ),
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
    // Score/rating do lead descontinuados (CTO, 02/10): o workflow salvo
    // continua listado e operável, só ganha o selo para ser achado e revisto.
    const discontinued =
      isDiscontinuedTrigger(workflow.trigger_type) || countDiscontinuedSteps(workflow.definition) > 0;

    return (
      <Card
        key={workflow.id}
        className="group flex cursor-pointer flex-col transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-relevo-alto motion-reduce:transition-none"
        onClick={() => navigate(`/automacoes/${workflow.id}`)}
      >
        <div className="flex items-start gap-3 p-5 pb-3">
          <span
            className={cn(
              "grid h-10 w-10 shrink-0 place-items-center rounded-xl",
              workflow.is_active ? "bg-primary-soft text-primary-soft-foreground" : "bg-muted text-foreground/60",
            )}
          >
            <TriggerIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <CardTitle className="truncate">{workflow.name}</CardTitle>
            {workflow.description && (
              <p className="mt-0.5 truncate text-[13px] text-muted-foreground">{workflow.description}</p>
            )}
          </div>
          <div className="flex shrink-0 items-center" onClick={(e) => e.stopPropagation()}>
            <Switch
              checked={workflow.is_active}
              onCheckedChange={() => handleToggle(workflow)}
              aria-label={workflow.is_active ? `Desativar ${workflow.name}` : `Ativar ${workflow.name}`}
            />
          </div>
        </div>
        <div className="mt-auto px-5 pb-4">
          <div className="flex items-center justify-between gap-2 text-sm">
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-muted-foreground">
              <Badge variant="soft" className="font-semibold">
                {TRIGGER_LABELS[workflow.trigger_type]}
              </Badge>
              {discontinued && <DiscontinuedBadge />}
              <span className="text-xs tabular-nums">{nodeCount} nós</span>
            </div>
            <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-[10px]"
                disabled={!canEditAutomation}
                aria-label={`Editar ${workflow.name}`}
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
                className="h-8 w-8 rounded-[10px]"
                onClick={(e) => {
                  e.stopPropagation();
                  void handleExport(workflow);
                }}
                title="Exportar workflow"
                aria-label={`Exportar ${workflow.name}`}
              >
                <Download className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-[10px] text-destructive hover:bg-destructive/10 hover:text-destructive"
                disabled={!canDeleteAutomation}
                aria-label={`Excluir ${workflow.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteTarget(workflow);
                }}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-1 border-t border-border/60 pt-3 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            Criado {formatDistanceToNow(new Date(workflow.created_at), { addSuffix: true, locale: ptBR })}
          </div>
        </div>
      </Card>
    );
  };

  const renderSection = (
    title: string,
    list: WorkflowType[],
    icon: React.ReactNode,
  ) => (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-[17px] font-bold tracking-[-0.02em]">
        {icon}
        {title}
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold tabular-nums text-foreground/70">
          {list.length}
        </span>
      </h2>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {list.map(renderWorkflowCard)}
      </div>
    </section>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Automações"
        subtitle="Crie e gerencie workflows visuais para automatizar ações no CRM"
        actions={
          <>
            <Button variant="outline" onClick={openImport} disabled={!canCreateAutomation}>
              <Upload />
              Importar
            </Button>
            <Button onClick={() => navigate("/automacoes/novo")} disabled={!canCreateAutomation}>
              <Plus />
              Novo Workflow
            </Button>
          </>
        }
      />

      {/* Templates */}
      <WorkflowTemplates />

      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : !workflows?.length ? (
        <Card className="border-dashed border-border shadow-none">
          <CardContent className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <span className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-primary-soft text-primary-soft-foreground">
              <Workflow className="h-7 w-7" />
            </span>
            <h3 className="mb-1 text-lg font-extrabold tracking-[-0.02em]">Nenhum workflow criado</h3>
            <p className="mb-5 max-w-md text-sm text-muted-foreground">
              Crie seu primeiro workflow visual para automatizar ações como enviar mensagens,
              mover leads e mais.
            </p>
            <Button onClick={() => navigate("/automacoes/novo")} disabled={!canCreateAutomation}>
              <Plus />
              Criar Primeiro Workflow
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {activeWorkflows.length > 0 &&
            renderSection("Ativos", activeWorkflows, <Play className="h-4 w-4 text-success" />)}
          {inactiveWorkflows.length > 0 &&
            renderSection("Inativos", inactiveWorkflows, <Pause className="h-4 w-4 text-muted-foreground" />)}
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
