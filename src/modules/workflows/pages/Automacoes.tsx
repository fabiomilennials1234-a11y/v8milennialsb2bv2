import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { InkRow, InkSplit } from "@/components/ui/bento";
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
  Zap,
  GitBranch,
  Tag,
  TrendingUp,
  Upload,
  Timer,
  LayoutTemplate,
} from "lucide-react";
import { toast } from "sonner";
import { useFeaturePermission } from "@/modules/identity";
import { useExportWorkflow, useImportWorkflow } from "@/modules/workflows/hooks/useWorkflowPortability";
import { WorkflowImportDialog } from "@/modules/workflows/components/WorkflowImportDialog";
import { WorkflowTemplates } from "@/modules/workflows/components/WorkflowTemplates";
import { WorkflowFocusCard } from "@/modules/workflows/components/WorkflowFocusCard";
import { AutomacoesTabs } from "@/modules/workflows/components/AutomacoesTabs";
import { TRIGGER_LABELS, isDiscontinuedTrigger } from "@/types/workflow";
import { DiscontinuedBadge } from "@/modules/workflows/components/DiscontinuedNotice";
import { countDiscontinuedSteps } from "@/modules/workflows/lib/discontinued-steps";
import { FilterChip } from "@/shared/components/FilterChip";
import { FilterRow, PillSearch } from "@/shared/components/PillSearch";
import { cn } from "@/lib/utils";
import type { Workflow as WorkflowType } from "@/types/workflow";

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
  const { allowed: canDeleteAutomation } = useFeaturePermission("workflows.delete");

  const activeCount = workflows?.filter((w) => w.is_active).length ?? 0;
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [query, setQuery] = useState("");
  const [focusId, setFocusId] = useState<string | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);

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

  const triggerIconOf = (w: WorkflowType) => TRIGGER_ICONS[w.trigger_type] || Zap;
  // Score/rating do lead descontinuados (CTO, 02/10): o workflow salvo
  // continua listado e operável, só ganha o selo para ser achado e revisto.
  const isDiscontinued = (w: WorkflowType) =>
    isDiscontinuedTrigger(w.trigger_type) || countDiscontinuedSteps(w.definition) > 0;

  // Ordenação única: editados recentemente (D18 — "mais executados" pediria
  // uma chamada por workflow).
  const sorted = [...(workflows ?? [])].sort(
    (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
  );
  const q = query.trim().toLowerCase();
  const visible = sorted.filter((w) => {
    if (statusFilter === "active" && !w.is_active) return false;
    if (statusFilter === "inactive" && w.is_active) return false;
    if (!q) return true;
    return `${w.name} ${w.description ?? ""} ${TRIGGER_LABELS[w.trigger_type] ?? ""}`.toLowerCase().includes(q);
  });
  const focus = visible.find((w) => w.id === focusId) ?? visible[0] ?? null;

  const header = (
    <PageHeader
      title="Automações"
      subtitle="Crie e gerencie workflows visuais que trabalham enquanto o time vende."
      tabs={<AutomacoesTabs active="workflows" workflowId={focus?.id ?? null} count={workflows?.length} />}
      secondaryActions={[
        { label: "Importar", icon: Upload, onSelect: openImport, disabled: !canCreateAutomation },
        { label: "Templates", icon: LayoutTemplate, onSelect: () => setGalleryOpen(true) },
      ]}
      actions={
        <Button onClick={() => navigate("/automacoes/novo")} disabled={!canCreateAutomation}>
          <Plus />
          Novo Workflow
        </Button>
      }
    />
  );

  return (
    <div className="space-y-5">
      {header}

      {/* Templates — fileira compacta; a galeria completa abre num Sheet */}
      <WorkflowTemplates galleryOpen={galleryOpen} onGalleryOpenChange={setGalleryOpen} />

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
          <FilterRow>
            <span className="mr-1 shrink-0 text-[15px] font-extrabold tracking-[-0.02em] text-foreground">Workflows</span>
            {(
              [
                ["all", "Todos", workflows.length],
                ["active", "Ativos", activeCount],
                ["inactive", "Inativos", workflows.length - activeCount],
              ] as const
            ).map(([key, label, count]) => (
              <FilterChip
                key={key}
                active={statusFilter === key}
                aria-pressed={statusFilter === key}
                count={count}
                onClick={() => setStatusFilter(key)}
              >
                {label}
              </FilterChip>
            ))}
            <PillSearch
              value={query}
              onValueChange={setQuery}
              placeholder="Buscar workflow ou gatilho"
              className="ml-auto w-56 shrink-0 sm:w-64"
            />
          </FilterRow>

          {focus ? (
            <InkSplit
              title="Seus workflows"
              count={`${activeCount} ${activeCount === 1 ? "ativo" : "ativos"}`}
              actions={
                <span className="rounded-full bg-white/[.08] px-3 py-1 text-[11px] font-bold text-tinta-foreground">
                  Editados recentemente
                </span>
              }
              listClassName="lg:max-h-[620px] lg:overflow-y-auto"
              list={
                <>
                  {visible.map((w) => {
                    const Icon = triggerIconOf(w);
                    const selected = w.id === focus.id;
                    const nodeCount = w.definition?.nodes?.length ?? 0;
                    return (
                      <InkRow key={w.id} selected={selected} onClick={() => setFocusId(w.id)}>
                        <span
                          className={cn(
                            "grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[11px]",
                            selected ? "bg-primary-foreground text-primary" : "bg-white/[.07] text-primary",
                          )}
                        >
                          <Icon className="h-4 w-4" aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-bold">{w.name}</span>
                          <span
                            className={cn(
                              "mt-0.5 flex items-center gap-1.5 text-[11px]",
                              selected ? "text-primary-foreground/70" : "text-tinta-muted",
                            )}
                          >
                            <span className="truncate">
                              {TRIGGER_LABELS[w.trigger_type] ?? w.trigger_type} · {nodeCount} nós
                            </span>
                            {isDiscontinued(w) && <DiscontinuedBadge className="px-1.5 py-0 text-[9px]" />}
                          </span>
                        </span>
                        <span
                          className={cn(
                            "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold",
                            selected
                              ? "bg-primary-foreground text-primary"
                              : w.is_active
                                ? "bg-success/15 text-success"
                                : "bg-white/10 text-tinta-muted",
                          )}
                        >
                          <span className={cn("h-1.5 w-1.5 rounded-full", w.is_active ? "bg-success" : "bg-current opacity-60")} />
                          {w.is_active ? "Ativo" : "Inativo"}
                        </span>
                      </InkRow>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => navigate("/automacoes/novo")}
                    disabled={!canCreateAutomation}
                    className="mt-1.5 flex items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 px-3 py-3.5 text-[13px] font-semibold text-tinta-muted transition-colors hover:border-white/25 hover:text-tinta-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
                  >
                    <Plus className="h-4 w-4" />
                    Novo Workflow
                  </button>
                </>
              }
              detail={
                <WorkflowFocusCard
                  workflow={focus}
                  triggerIcon={triggerIconOf(focus)}
                  discontinued={isDiscontinued(focus)}
                  canDelete={canDeleteAutomation}
                  togglePending={toggleWorkflow.isPending}
                  onToggle={() => handleToggle(focus)}
                  onOpen={() => navigate(`/automacoes/${focus.id}`)}
                  onExecutions={() => navigate(`/automacoes/${focus.id}/execucoes`)}
                  onExport={() => void handleExport(focus)}
                  onDelete={() => setDeleteTarget(focus)}
                />
              }
            />
          ) : (
            <div className="rounded-card border border-dashed border-border bg-card/60 px-6 py-12 text-center">
              <p className="text-sm font-bold text-foreground">Nenhum workflow com esses filtros</p>
              <p className="mt-1 text-sm text-muted-foreground">Troque o filtro ou a busca.</p>
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
