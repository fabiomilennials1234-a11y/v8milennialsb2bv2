import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Settings2,
  Layers,
  Plus,
  Trash2,
  GripVertical,
  Pencil,
  Check,
  X,
  Loader2,
  AlertTriangle,
  Palette,
  FileSpreadsheet,
  ClipboardList,
} from "lucide-react";
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
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  type CustomPipeline,
  type CustomPipelineStage,
  useCreateCustomPipelineStage,
  useUpdateCustomPipelineStage,
  useDeleteCustomPipelineStage,
  useReorderCustomPipelineStages,
  useUpdateCustomPipeline,
} from "@/modules/pipelines/hooks/custom/useCustomPipelines";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TransitionSelector } from "@/modules/pipelines/components/shared/TransitionSelector";
import { PIPELINE_COLORS, PIPELINE_ICONS } from "./CreatePipelineModal";
import { ImportCustomPipelineContent } from "./ImportCustomPipelineContent";
import { useChecklistTemplates } from "@/modules/engagement/hooks/useChecklistTemplates";

const STAGE_COLORS = [
  "#3b82f6", "#22c55e", "#eab308", "#f97316", "#ef4444",
  "#8b5cf6", "#ec4899", "#06b6d4", "#64748b",
];

// ────────────────────────────────────────────────────────────
// Sortable Stage Item
// ────────────────────────────────────────────────────────────

function SortableStageItem({
  stage,
  onEdit,
  onDelete,
  isEditing,
  editName,
  editColor,
  editIsFinalPositive,
  editIsFinalNegative,
  editTargetPipelineId,
  editTargetStageId,
  editTargetPipeType,
  editTargetStageKey,
  currentPipelineId,
  onEditNameChange,
  onEditColorChange,
  onEditIsFinalPositiveChange,
  onEditIsFinalNegativeChange,
  onEditTargetChange,
  onSaveEdit,
  onCancelEdit,
  isSaving,
  templates,
  onChecklistTemplateChange,
}: {
  stage: CustomPipelineStage;
  onEdit: () => void;
  onDelete: () => void;
  isEditing: boolean;
  editName: string;
  editColor: string;
  editIsFinalPositive: boolean;
  editIsFinalNegative: boolean;
  editTargetPipelineId: string | null;
  editTargetStageId: string | null;
  editTargetPipeType: string | null;
  editTargetStageKey: string | null;
  currentPipelineId: string;
  onEditNameChange: (name: string) => void;
  onEditColorChange: (color: string) => void;
  onEditIsFinalPositiveChange: (value: boolean) => void;
  onEditIsFinalNegativeChange: (value: boolean) => void;
  onEditTargetChange: (updates: {
    targetPipelineId: string | null;
    targetStageId: string | null;
    targetPipeType: string | null;
    targetStageKey: string | null;
  }) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  isSaving: boolean;
  templates: { id: string; title: string; total_items: number }[];
  onChecklistTemplateChange: (templateId: string | null) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: stage.id });

  const style = { transform: CSS.Transform.toString(transform), transition };
  const hasTransition = stage.target_pipeline_id || stage.target_pipe_type;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-start gap-3 p-3 bg-card border rounded-lg",
        isDragging && "opacity-50 shadow-lg"
      )}
    >
      <button
        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground mt-0.5"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="w-5 h-5" />
      </button>

      {isEditing ? (
        <div className="flex-1 space-y-3">
          <div className="flex items-center gap-2">
            <Input
              value={editName}
              onChange={(e) => onEditNameChange(e.target.value)}
              placeholder="Nome da etapa"
              className="flex-1"
              autoFocus
            />
            <Button size="icon" variant="ghost" onClick={onSaveEdit} disabled={isSaving || !editName.trim()}>
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4 text-green-500" />}
            </Button>
            <Button size="icon" variant="ghost" onClick={onCancelEdit}>
              <X className="w-4 h-4 text-red-500" />
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">Cor:</Label>
            <div className="flex gap-1">
              {STAGE_COLORS.map((color) => (
                <button
                  key={color}
                  className={cn(
                    "w-6 h-6 rounded-full border-2 transition-all",
                    editColor === color ? "border-foreground scale-110" : "border-transparent hover:scale-105"
                  )}
                  style={{ backgroundColor: color }}
                  onClick={() => onEditColorChange(color)}
                />
              ))}
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Checkbox
                id={`pos-${stage.id}`}
                checked={editIsFinalPositive}
                onCheckedChange={(c) => { onEditIsFinalPositiveChange(!!c); if (c) onEditIsFinalNegativeChange(false); }}
              />
              <Label htmlFor={`pos-${stage.id}`} className="text-sm">Etapa de sucesso</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id={`neg-${stage.id}`}
                checked={editIsFinalNegative}
                onCheckedChange={(c) => { onEditIsFinalNegativeChange(!!c); if (c) onEditIsFinalPositiveChange(false); }}
              />
              <Label htmlFor={`neg-${stage.id}`} className="text-sm">Etapa de perda</Label>
            </div>
          </div>
          {editIsFinalPositive && (
            <TransitionSelector
              targetPipelineId={editTargetPipelineId}
              targetStageId={editTargetStageId}
              targetPipeType={editTargetPipeType}
              targetStageKey={editTargetStageKey}
              currentPipelineId={currentPipelineId}
              onChangeTarget={onEditTargetChange}
            />
          )}
        </div>
      ) : (
        <>
          <div className="w-4 h-4 rounded-full shrink-0 mt-0.5" style={{ backgroundColor: stage.color || "#64748b" }} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium">{stage.name}</span>
              {stage.is_final_positive && (
                <span className="text-xs text-green-600 bg-green-100 dark:bg-green-900/30 px-2 py-0.5 rounded">Sucesso</span>
              )}
              {stage.is_final_negative && (
                <span className="text-xs text-red-600 bg-red-100 dark:bg-red-900/30 px-2 py-0.5 rounded">Perda</span>
              )}
              {hasTransition && (
                <span className="text-xs text-blue-600 bg-blue-100 dark:bg-blue-900/30 px-2 py-0.5 rounded">
                  → Transição
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground">
              <ClipboardList className="w-3 h-3 shrink-0" />
              <Select
                value={stage.checklist_template_id ?? "__none__"}
                onValueChange={(v) =>
                  onChecklistTemplateChange(v === "__none__" ? null : v)
                }
              >
                <SelectTrigger className="h-6 text-xs border-dashed flex-1 max-w-[260px] px-2">
                  <SelectValue placeholder="Sem checklist automático" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Sem checklist automático</SelectItem>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.title}{" "}
                      <span className="text-muted-foreground">({t.total_items})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button size="icon" variant="ghost" onClick={onEdit}><Pencil className="w-4 h-4" /></Button>
            <Button size="icon" variant="ghost" onClick={onDelete} className="text-destructive hover:text-destructive">
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Stages Tab Content
// ────────────────────────────────────────────────────────────

function StagesTabContent({
  pipeline,
  stages,
}: {
  pipeline: CustomPipeline;
  stages: CustomPipelineStage[];
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");
  const [editIsFinalPositive, setEditIsFinalPositive] = useState(false);
  const [editIsFinalNegative, setEditIsFinalNegative] = useState(false);
  const [editTargetPipelineId, setEditTargetPipelineId] = useState<string | null>(null);
  const [editTargetStageId, setEditTargetStageId] = useState<string | null>(null);
  const [editTargetPipeType, setEditTargetPipeType] = useState<string | null>(null);
  const [editTargetStageKey, setEditTargetStageKey] = useState<string | null>(null);
  const [newStageName, setNewStageName] = useState("");
  const [newStageColor, setNewStageColor] = useState(STAGE_COLORS[0]);
  const [showNewStageForm, setShowNewStageForm] = useState(false);
  const [deleteStageId, setDeleteStageId] = useState<string | null>(null);
  const [localStages, setLocalStages] = useState(stages);

  const createStage = useCreateCustomPipelineStage();
  const updateStage = useUpdateCustomPipelineStage();
  const deleteStage = useDeleteCustomPipelineStage();
  const reorderStages = useReorderCustomPipelineStages();
  const { data: templates = [] } = useChecklistTemplates();

  const handleChecklistTemplateChange = async (
    stage: CustomPipelineStage,
    templateId: string | null,
  ) => {
    try {
      await updateStage.mutateAsync({
        id: stage.id,
        pipeline_id: pipeline.id,
        checklist_template_id: templateId,
      });
      toast.success(
        templateId
          ? "Checklist automático configurado"
          : "Checklist automático removido",
      );
    } catch (error: any) {
      toast.error(error.message || "Erro ao atualizar checklist automático");
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Sync local stages quando props mudar
  if (stages.length !== localStages.length || stages.some((s, i) => s.id !== localStages[i]?.id)) {
    setLocalStages(stages);
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = localStages.findIndex((s) => s.id === active.id);
      const newIndex = localStages.findIndex((s) => s.id === over.id);
      const newOrder = arrayMove(localStages, oldIndex, newIndex);
      setLocalStages(newOrder);

      try {
        await reorderStages.mutateAsync({
          pipeline_id: pipeline.id,
          stages: newOrder.map((s, i) => ({ id: s.id, position: i })),
        });
        toast.success("Ordem atualizada");
      } catch {
        toast.error("Erro ao reordenar");
        setLocalStages(stages);
      }
    }
  };

  const startEditing = (stage: CustomPipelineStage) => {
    setEditingId(stage.id);
    setEditName(stage.name);
    setEditColor(stage.color || STAGE_COLORS[0]);
    setEditIsFinalPositive(stage.is_final_positive);
    setEditIsFinalNegative(stage.is_final_negative);
    setEditTargetPipelineId(stage.target_pipeline_id);
    setEditTargetStageId(stage.target_stage_id);
    setEditTargetPipeType(stage.target_pipe_type);
    setEditTargetStageKey(stage.target_stage_key);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditName("");
    setEditColor("");
    setEditTargetPipelineId(null);
    setEditTargetStageId(null);
    setEditTargetPipeType(null);
    setEditTargetStageKey(null);
  };

  const handleSaveEdit = async () => {
    if (!editingId || !editName.trim()) return;
    try {
      // Clear targets if not a success stage
      const finalTargetPipelineId = editIsFinalPositive ? editTargetPipelineId : null;
      const finalTargetStageId = editIsFinalPositive ? editTargetStageId : null;
      const finalTargetPipeType = editIsFinalPositive ? editTargetPipeType : null;
      const finalTargetStageKey = editIsFinalPositive ? editTargetStageKey : null;

      await updateStage.mutateAsync({
        id: editingId,
        pipeline_id: pipeline.id,
        name: editName.trim(),
        color: editColor,
        is_final_positive: editIsFinalPositive,
        is_final_negative: editIsFinalNegative,
        target_pipeline_id: finalTargetPipelineId,
        target_stage_id: finalTargetStageId,
        target_pipe_type: finalTargetPipeType,
        target_stage_key: finalTargetStageKey,
      });
      toast.success("Etapa atualizada");
      cancelEditing();
    } catch {
      toast.error("Erro ao atualizar etapa");
    }
  };

  const handleCreateStage = async () => {
    if (!newStageName.trim()) return;
    try {
      await createStage.mutateAsync({
        pipeline_id: pipeline.id,
        name: newStageName.trim(),
        color: newStageColor,
        position: localStages.length,
      });
      toast.success("Etapa criada");
      setNewStageName("");
      setNewStageColor(STAGE_COLORS[0]);
      setShowNewStageForm(false);
    } catch (error: any) {
      toast.error(error.message || "Erro ao criar etapa");
    }
  };

  const handleDeleteStage = async () => {
    if (!deleteStageId) return;
    try {
      await deleteStage.mutateAsync({ id: deleteStageId, pipeline_id: pipeline.id });
      toast.success("Etapa removida");
      setDeleteStageId(null);
    } catch (error: any) {
      toast.error(error.message || "Erro ao remover etapa");
    }
  };

  return (
    <>
      <div className="space-y-4">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={localStages.map((s) => s.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {localStages.map((stage) => (
                <SortableStageItem
                  key={stage.id}
                  stage={stage}
                  onEdit={() => startEditing(stage)}
                  onDelete={() => setDeleteStageId(stage.id)}
                  isEditing={editingId === stage.id}
                  editName={editName}
                  editColor={editColor}
                  editIsFinalPositive={editIsFinalPositive}
                  editIsFinalNegative={editIsFinalNegative}
                  editTargetPipelineId={editTargetPipelineId}
                  editTargetStageId={editTargetStageId}
                  editTargetPipeType={editTargetPipeType}
                  editTargetStageKey={editTargetStageKey}
                  currentPipelineId={pipeline.id}
                  onEditNameChange={setEditName}
                  onEditColorChange={setEditColor}
                  onEditIsFinalPositiveChange={setEditIsFinalPositive}
                  onEditIsFinalNegativeChange={setEditIsFinalNegative}
                  onEditTargetChange={({ targetPipelineId, targetStageId, targetPipeType, targetStageKey }) => {
                    setEditTargetPipelineId(targetPipelineId);
                    setEditTargetStageId(targetStageId);
                    setEditTargetPipeType(targetPipeType);
                    setEditTargetStageKey(targetStageKey);
                  }}
                  onSaveEdit={handleSaveEdit}
                  onCancelEdit={cancelEditing}
                  isSaving={updateStage.isPending}
                  templates={templates}
                  onChecklistTemplateChange={(templateId) =>
                    handleChecklistTemplateChange(stage, templateId)
                  }
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>

        {localStages.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">Nenhuma etapa criada</div>
        )}

        {showNewStageForm ? (
          <div className="p-4 bg-muted rounded-lg space-y-3">
            <Input
              value={newStageName}
              onChange={(e) => setNewStageName(e.target.value)}
              placeholder="Nome da nova etapa"
              autoFocus
            />
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">Cor:</Label>
              <div className="flex gap-1">
                {STAGE_COLORS.map((color) => (
                  <button
                    key={color}
                    className={cn(
                      "w-6 h-6 rounded-full border-2 transition-all",
                      newStageColor === color ? "border-foreground scale-110" : "border-transparent hover:scale-105"
                    )}
                    style={{ backgroundColor: color }}
                    onClick={() => setNewStageColor(color)}
                  />
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleCreateStage} disabled={!newStageName.trim() || createStage.isPending} className="flex-1">
                {createStage.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                Criar Etapa
              </Button>
              <Button variant="outline" onClick={() => { setShowNewStageForm(false); setNewStageName(""); }}>
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" className="w-full" onClick={() => setShowNewStageForm(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Adicionar Etapa
          </Button>
        )}
      </div>

      <AlertDialog open={!!deleteStageId} onOpenChange={() => setDeleteStageId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-destructive" />
              Remover Etapa
            </AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza? Leads nesta etapa precisarão ser movidos para outra etapa.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteStage} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleteStage.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ────────────────────────────────────────────────────────────
// General Settings Tab
// ────────────────────────────────────────────────────────────

function GeneralTabContent({
  pipeline,
  onRequestDelete,
}: {
  pipeline: CustomPipeline;
  onRequestDelete?: () => void;
}) {
  const [name, setName] = useState(pipeline.name);
  const [icon, setIcon] = useState(pipeline.icon);
  const [color, setColor] = useState(pipeline.color);
  const updatePipeline = useUpdateCustomPipeline();

  const hasChanges = name !== pipeline.name || icon !== pipeline.icon || color !== pipeline.color;

  const handleSave = async () => {
    try {
      await updatePipeline.mutateAsync({ id: pipeline.id, name, icon, color });
      toast.success("Funil atualizado");
    } catch (error: any) {
      toast.error(error.message || "Erro ao atualizar");
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Nome do Funil</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div className="space-y-2">
        <Label>Ícone</Label>
        <div className="flex flex-wrap gap-2">
          {PIPELINE_ICONS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.name}
                onClick={() => setIcon(item.name)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm transition-all",
                  icon === item.name ? "border-primary bg-primary/10 text-primary" : "border-border hover:border-primary/50"
                )}
              >
                <Icon className="w-4 h-4" />
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <Label>Cor</Label>
        <div className="flex gap-2">
          {PIPELINE_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className={cn(
                "w-8 h-8 rounded-full border-2 transition-all",
                color === c ? "border-foreground scale-110" : "border-transparent hover:scale-105"
              )}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </div>

      {hasChanges && (
        <Button onClick={handleSave} disabled={!name.trim() || updatePipeline.isPending}>
          {updatePipeline.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Salvar Alterações
        </Button>
      )}

      {onRequestDelete && (
        <div className="pt-6 mt-2 border-t border-destructive/20 space-y-2">
          <p className="text-sm font-semibold text-destructive">Zona de Perigo</p>
          <p className="text-xs text-muted-foreground">
            Excluir apaga o funil, suas etapas e todos os cards em definitivo — junto com
            o histórico de etapas que alimenta as métricas deste funil. Os leads
            permanecem no sistema.
          </p>
          <Button
            variant="destructive"
            size="sm"
            onClick={onRequestDelete}
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Excluir Funil
          </Button>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Main Dialog
// ────────────────────────────────────────────────────────────

interface CustomPipeSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipeline: CustomPipeline;
  stages: CustomPipelineStage[];
  onRequestDelete?: () => void;
}

export function CustomPipeSettingsDialog({
  open,
  onOpenChange,
  pipeline,
  stages,
  onRequestDelete,
}: CustomPipeSettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[700px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="w-5 h-5 text-primary" />
            Configurações — {pipeline.name}
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="etapas">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="etapas" className="gap-1.5 text-xs">
              <Layers className="w-3.5 h-3.5" />
              Etapas
            </TabsTrigger>
            <TabsTrigger value="importar" className="gap-1.5 text-xs">
              <FileSpreadsheet className="w-3.5 h-3.5" />
              Importar
            </TabsTrigger>
            <TabsTrigger value="geral" className="gap-1.5 text-xs">
              <Palette className="w-3.5 h-3.5" />
              Geral
            </TabsTrigger>
          </TabsList>

          <div className="overflow-y-auto max-h-[calc(85vh-12rem)] mt-4 pr-1">
            <TabsContent value="etapas" className="mt-0">
              <StagesTabContent pipeline={pipeline} stages={stages} />
            </TabsContent>
            <TabsContent value="importar" className="mt-0">
              <ImportCustomPipelineContent
                pipelineId={pipeline.id}
                pipelineName={pipeline.name}
                stages={stages}
              />
            </TabsContent>
            <TabsContent value="geral" className="mt-0">
              <GeneralTabContent pipeline={pipeline} onRequestDelete={onRequestDelete} />
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
