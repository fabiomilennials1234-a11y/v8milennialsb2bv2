import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  Settings2,
  Plus,
  Search,
  Loader2,
  AlertTriangle,
  Trash2,
  Kanban,
  Target,
  Users,
  ShoppingBag,
  Heart,
  Briefcase,
  Star,
  Zap,
  Gift,
} from "lucide-react";
import {
  useCustomPipeline,
  useCustomPipelineStages,
  useCustomPipeEntries,
  useRemoveLeadFromCustomPipe,
  useDeleteCustomPipeline,
} from "@/hooks/useCustomPipelines";
import { CustomPipelineKanban } from "@/components/custom-pipelines/CustomPipelineKanban";
import { LeadDetailDrawer } from "@/components/leads/LeadDetailDrawer";
import { AddLeadToPipeModal } from "@/components/custom-pipelines/AddLeadToPipeModal";
import { CustomPipeSettingsDialog } from "@/components/custom-pipelines/CustomPipeSettingsDialog";
import { toast } from "sonner";
import type { LucideIcon } from "lucide-react";
import { useFeaturePermission } from "@/hooks/useUserRole";

const ICON_MAP: Record<string, LucideIcon> = {
  kanban: Kanban,
  target: Target,
  users: Users,
  "shopping-bag": ShoppingBag,
  heart: Heart,
  briefcase: Briefcase,
  star: Star,
  zap: Zap,
  gift: Gift,
};

export default function CustomPipelinePage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();

  const [searchQuery, setSearchQuery] = useState("");
  const [showAddLead, setShowAddLead] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [removeEntryId, setRemoveEntryId] = useState<string | null>(null);
  const [showDeletePipeline, setShowDeletePipeline] = useState(false);
  const [isDetailDrawerOpen, setIsDetailDrawerOpen] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<any>(null);

  const { data: pipeline, isLoading: loadingPipeline } = useCustomPipeline(slug);
  const { data: stages = [], isLoading: loadingStages } = useCustomPipelineStages(pipeline?.id);
  const { data: entries = [], isLoading: loadingEntries } = useCustomPipeEntries(pipeline?.id);

  const removeLead = useRemoveLeadFromCustomPipe();
  const deletePipeline = useDeleteCustomPipeline();
  const { allowed: canDeletePipeline } = useFeaturePermission("pipeline.delete");
  const { allowed: canDeleteCards } = useFeaturePermission("pipeline.delete_cards");

  const isLoading = loadingPipeline || loadingStages || loadingEntries;

  const handleRemoveEntry = async () => {
    if (!removeEntryId || !pipeline) return;
    try {
      await removeLead.mutateAsync({ entry_id: removeEntryId, pipeline_id: pipeline.id });
      toast.success("Lead removido do funil");
      setRemoveEntryId(null);
    } catch {
      toast.error("Erro ao remover lead");
    }
  };

  const handleDeletePipeline = async () => {
    if (!pipeline) return;
    try {
      await deletePipeline.mutateAsync(pipeline.id);
      toast.success(`Funil "${pipeline.name}" excluído`);
      navigate("/");
    } catch {
      toast.error("Erro ao excluir funil");
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!pipeline) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
        <AlertTriangle className="w-12 h-12 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Funil não encontrado</h2>
        <Button variant="outline" onClick={() => navigate("/")}>
          Voltar ao Dashboard
        </Button>
      </div>
    );
  }

  const PipeIcon = ICON_MAP[pipeline.icon] || Kanban;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: `${pipeline.color}20` }}
          >
            <PipeIcon className="w-5 h-5" style={{ color: pipeline.color }} />
          </div>
          <div>
            <h1 className="text-xl font-bold">{pipeline.name}</h1>
            {pipeline.description && (
              <p className="text-sm text-muted-foreground">{pipeline.description}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowSettings(true)}
          >
            <Settings2 className="w-4 h-4 mr-2" />
            Configurações
          </Button>
          <Button size="sm" onClick={() => setShowAddLead(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Adicionar Lead
          </Button>
        </div>
      </div>

      {/* Stats + Search */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar lead, empresa, telefone..."
            className="pl-9"
          />
        </div>
        <div className="text-sm text-muted-foreground">
          {entries.length} {entries.length === 1 ? "lead" : "leads"} no funil
        </div>
      </div>

      {/* Kanban */}
      {stages.length > 0 ? (
        <CustomPipelineKanban
          pipeline={pipeline}
          stages={stages}
          entries={entries}
          searchQuery={searchQuery}
          onRemoveEntry={canDeleteCards ? (id) => setRemoveEntryId(id) : undefined}
          onClickEntry={(entry) => {
            setSelectedEntry(entry);
            setIsDetailDrawerOpen(true);
          }}
        />
      ) : (
        <div className="text-center py-16 text-muted-foreground">
          <Kanban className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p className="text-lg font-medium">Nenhuma etapa configurada</p>
          <p className="text-sm mt-1">Abra as configurações para criar etapas.</p>
          <Button variant="outline" className="mt-4" onClick={() => setShowSettings(true)}>
            <Settings2 className="w-4 h-4 mr-2" />
            Configurar Etapas
          </Button>
        </div>
      )}

      {/* Modals */}
      {pipeline && stages.length > 0 && (
        <AddLeadToPipeModal
          open={showAddLead}
          onOpenChange={setShowAddLead}
          pipelineId={pipeline.id}
          pipelineName={pipeline.name}
          stages={stages}
        />
      )}

      {pipeline && (
        <CustomPipeSettingsDialog
          open={showSettings}
          onOpenChange={setShowSettings}
          pipeline={pipeline}
          stages={stages}
          onRequestDelete={() => {
            setShowSettings(false);
            setShowDeletePipeline(true);
          }}
        />
      )}

      {/* Confirmar exclusão do funil */}
      <AlertDialog open={showDeletePipeline} onOpenChange={setShowDeletePipeline}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-destructive" />
              Excluir Funil "{pipeline?.name}"?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. O funil será desativado e deixará de aparecer na sidebar e em todas as listagens.
              <br /><br />
              <strong>Os leads e registros do sistema não serão apagados.</strong>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeletePipeline}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletePipeline.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Excluir Funil
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Lead Detail Drawer */}
      <LeadDetailDrawer
        open={isDetailDrawerOpen}
        onOpenChange={setIsDetailDrawerOpen}
        leadId={selectedEntry?.lead_id || null}
        variant="custom"
        pipeData={selectedEntry}
      />

      {/* Confirmar remoção de lead */}
      <AlertDialog open={!!removeEntryId} onOpenChange={() => setRemoveEntryId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover Lead do Funil</AlertDialogTitle>
            <AlertDialogDescription>
              O lead será removido deste funil, mas continuará existindo no sistema.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRemoveEntry}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {removeLead.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
