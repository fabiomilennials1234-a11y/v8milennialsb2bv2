import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  PipelineStage,
  PipelineType,
  StageFamily,
  useCreatePipelineStage,
  useUpdatePipelineStage,
  useDeletePipelineStage,
  useReorderPipelineStages,
  usePipelineStageLeadCounts,
  getPipelineTypeName,
  getStageFamilyName,
} from "@/modules/pipelines/hooks/model/usePipelineStages";
import { useCustomPipelines } from "@/modules/pipelines/hooks/custom/useCustomPipelines";
import {
  TransitionSelector,
  type TransitionTarget,
} from "@/modules/pipelines/components/shared/TransitionSelector";
import { classifyStageRole } from "@/modules/pipelines/lib/stage-role-classifier";
import { STAGE_ROLES, STAGE_ROLE_META } from "@/modules/pipelines/lib/stage-role";
import type { StageRole } from "@/contracts/pipe";
import {
  Plus,
  Trash2,
  GripVertical,
  Pencil,
  Check,
  X,
  Loader2,
  AlertTriangle,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useChecklistTemplates } from "@/modules/engagement/hooks/useChecklistTemplates";
import { ClipboardList } from "lucide-react";
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

interface ManagePipelineStagesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipelineType: StageFamily;
  stages: PipelineStage[];
}

// Cores predefinidas para etapas
const STAGE_COLORS = [
  "#3b82f6", // blue
  "#22c55e", // green
  "#eab308", // yellow
  "#f97316", // orange
  "#ef4444", // red
  "#8b5cf6", // purple
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#64748b", // slate
];

/**
 * Dropdown do papel semântico da etapa (stage_role, ADR-0017 §1).
 *
 * won/lost selecionáveis manualmente — escolha explícita do admin conta como
 * confirmação humana. A sugestão do classifier (#991) só PRÉ-PREENCHE; quem
 * decide é sempre quem salva.
 */
function StageRoleSelect({
  value,
  onChange,
  isSuggested,
  idSuffix,
}: {
  value: StageRole;
  onChange: (role: StageRole) => void;
  isSuggested?: boolean;
  idSuffix: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Label htmlFor={`stage-role-${idSuffix}`} className="text-xs text-muted-foreground">
          Papel nas métricas
        </Label>
        {isSuggested && (
          <span className="inline-flex items-center gap-1 text-[11px] text-primary">
            <Sparkles className="w-3 h-3" />
            Sugerido pelo nome
          </span>
        )}
      </div>
      <Select value={value} onValueChange={(v) => onChange(v as StageRole)}>
        <SelectTrigger id={`stage-role-${idSuffix}`} className="h-auto min-h-10 py-1.5">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STAGE_ROLES.map((role) => (
            <SelectItem key={role} value={role}>
              <div className="flex items-center gap-2.5 py-0.5">
                <span
                  className={cn("w-2 h-2 rounded-full shrink-0", STAGE_ROLE_META[role].dotClassName)}
                />
                <div className="min-w-0 text-left">
                  <div className="text-sm font-medium leading-tight">
                    {STAGE_ROLE_META[role].label}
                  </div>
                  <div className="text-xs text-muted-foreground leading-tight">
                    {STAGE_ROLE_META[role].description}
                  </div>
                </div>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// Gerar stage_key a partir do nome
function generateStageKey(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// Componente de etapa arrastável
function SortableStageItem({
  stage,
  pipelineType,
  onEdit,
  onDelete,
  isEditing,
  editName,
  editColor,
  editIsFinalPositive,
  editIsFinalNegative,
  editStageRole,
  editTargetPipelineId,
  editTargetStageId,
  editTargetPipeType,
  editTargetStageKey,
  onEditNameChange,
  onEditColorChange,
  onEditIsFinalPositiveChange,
  onEditIsFinalNegativeChange,
  onEditStageRoleChange,
  onEditTargetChange,
  onSaveEdit,
  onCancelEdit,
  isSaving,
  templates,
  onChecklistTemplateChange,
}: {
  stage: PipelineStage;
  pipelineType: StageFamily;
  onEdit: () => void;
  onDelete: () => void;
  isEditing: boolean;
  editName: string;
  editColor: string;
  editIsFinalPositive: boolean;
  editIsFinalNegative: boolean;
  editStageRole: StageRole;
  editTargetPipelineId: string | null;
  editTargetStageId: string | null;
  editTargetPipeType: string | null;
  editTargetStageKey: string | null;
  onEditNameChange: (name: string) => void;
  onEditColorChange: (color: string) => void;
  onEditIsFinalPositiveChange: (value: boolean) => void;
  onEditIsFinalNegativeChange: (value: boolean) => void;
  onEditStageRoleChange: (role: StageRole) => void;
  onEditTargetChange: (updates: TransitionTarget) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  isSaving: boolean;
  templates: { id: string; title: string; total_items: number }[];
  onChecklistTemplateChange: (templateId: string | null) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: stage.id });

  const { data: customPipelines } = useCustomPipelines();

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-3 p-3 bg-card border rounded-lg",
        isDragging && "opacity-50 shadow-lg"
      )}
    >
      <button
        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
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
            <Button
              size="icon"
              variant="ghost"
              onClick={onSaveEdit}
              disabled={isSaving || !editName.trim()}
            >
              {isSaving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Check className="w-4 h-4 text-green-500" />
              )}
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
                    editColor === color
                      ? "border-foreground scale-110"
                      : "border-transparent hover:scale-105"
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
                id={`positive-${stage.id}`}
                checked={editIsFinalPositive}
                onCheckedChange={(checked) => {
                  onEditIsFinalPositiveChange(!!checked);
                  if (checked) onEditIsFinalNegativeChange(false);
                }}
              />
              <Label htmlFor={`positive-${stage.id}`} className="text-sm">
                Etapa de sucesso (ex: Vendido)
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id={`negative-${stage.id}`}
                checked={editIsFinalNegative}
                onCheckedChange={(checked) => {
                  onEditIsFinalNegativeChange(!!checked);
                  if (checked) onEditIsFinalPositiveChange(false);
                }}
              />
              <Label htmlFor={`negative-${stage.id}`} className="text-sm">
                Etapa de perda (ex: Perdido)
              </Label>
            </div>
          </div>
          <StageRoleSelect
            value={editStageRole}
            onChange={onEditStageRoleChange}
            idSuffix={stage.id}
          />
          {/* Transição automática — só para etapas de sucesso. Destino pode ser
              pipe padrão OU funil customizado da org (componente unificado). */}
          {editIsFinalPositive && (
            <div className="pt-2 border-t border-border/50">
              <TransitionSelector
                targetPipelineId={editTargetPipelineId}
                targetStageId={editTargetStageId}
                targetPipeType={editTargetPipeType}
                targetStageKey={editTargetStageKey}
                currentPipeType={pipelineType}
                onChangeTarget={onEditTargetChange}
              />
            </div>
          )}
        </div>
      ) : (
        <>
          <div
            className="w-4 h-4 rounded-full shrink-0"
            style={{ backgroundColor: stage.color || "#64748b" }}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium">{stage.name}</span>
              {stage.stage_role && stage.stage_role !== "open" && (
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 text-xs border px-2 py-0.5 rounded-full",
                    STAGE_ROLE_META[stage.stage_role].badgeClassName,
                  )}
                >
                  <span
                    className={cn(
                      "w-1.5 h-1.5 rounded-full",
                      STAGE_ROLE_META[stage.stage_role].dotClassName,
                    )}
                  />
                  {STAGE_ROLE_META[stage.stage_role].label}
                </span>
              )}
              {stage.suggested_stage_role && (
                <span className="inline-flex items-center gap-1 text-xs border border-amber-500/30 bg-amber-500/10 text-amber-500 px-2 py-0.5 rounded-full">
                  <Sparkles className="w-3 h-3" />
                  Sugestão: {STAGE_ROLE_META[stage.suggested_stage_role].label} · em revisão
                </span>
              )}
              {stage.is_final_positive && (
                <span className="text-xs text-green-600 bg-green-100 px-2 py-0.5 rounded">
                  Sucesso
                </span>
              )}
              {stage.is_final_positive && stage.target_pipe_type && (
                <span className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                  → {getPipelineTypeName(stage.target_pipe_type as PipelineType)}
                </span>
              )}
              {stage.is_final_positive && stage.target_pipeline_id && (
                <span className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                  → {customPipelines?.find((p) => p.id === stage.target_pipeline_id)?.name ?? "Funil custom"}
                </span>
              )}
              {stage.is_final_negative && (
                <span className="text-xs text-red-600 bg-red-100 px-2 py-0.5 rounded">
                  Perda
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
            <Button size="icon" variant="ghost" onClick={onEdit}>
              <Pencil className="w-4 h-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={onDelete}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

interface ManagePipelineStagesContentProps {
  pipelineType: StageFamily;
  stages: PipelineStage[];
}

export function ManagePipelineStagesContent({
  pipelineType,
  stages,
}: ManagePipelineStagesContentProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");
  const [editIsFinalPositive, setEditIsFinalPositive] = useState(false);
  const [editIsFinalNegative, setEditIsFinalNegative] = useState(false);
  const [editStageRole, setEditStageRole] = useState<StageRole>("open");
  const [editTargetPipelineId, setEditTargetPipelineId] = useState<string | null>(null);
  const [editTargetStageId, setEditTargetStageId] = useState<string | null>(null);
  const [editTargetPipeType, setEditTargetPipeType] = useState<string | null>(null);
  const [editTargetStageKey, setEditTargetStageKey] = useState<string | null>(null);
  const [newStageName, setNewStageName] = useState("");
  const [newStageColor, setNewStageColor] = useState(STAGE_COLORS[0]);
  const [newStageIsFinalPositive, setNewStageIsFinalPositive] = useState(false);
  const [newStageIsFinalNegative, setNewStageIsFinalNegative] = useState(false);
  // stage_role da etapa nova: pré-preenchido pelo classifier (#991) enquanto o
  // usuário digita o nome; ao tocar no dropdown a escolha humana passa a valer.
  const [newStageRoleTouched, setNewStageRoleTouched] = useState(false);
  const [newStageRoleManual, setNewStageRoleManual] = useState<StageRole>("open");
  const [showNewStageForm, setShowNewStageForm] = useState(false);
  const [deleteStageId, setDeleteStageId] = useState<string | null>(null);
  const [migrateToStageKey, setMigrateToStageKey] = useState<string>("");
  const [localStages, setLocalStages] = useState<PipelineStage[]>(stages);

  const createStage = useCreatePipelineStage();
  const updateStage = useUpdatePipelineStage();
  const deleteStage = useDeletePipelineStage();
  const reorderStages = useReorderPipelineStages();
  const { data: templates = [] } = useChecklistTemplates();
  const { data: stageLeadCounts = {} } = usePipelineStageLeadCounts(pipelineType);

  // Sugestão do classifier pro nome digitado (flags entram como sinal fraco).
  const newStageRoleSuggestion = classifyStageRole({
    name: newStageName,
    isFinalPositive: newStageIsFinalPositive,
    isFinalNegative: newStageIsFinalNegative,
  });
  const newStageRole: StageRole = newStageRoleTouched
    ? newStageRoleManual
    : newStageRoleSuggestion?.role ?? "open";

  // Etapa marcada para remoção + quantos leads ela ainda tem.
  const stageToDelete = localStages.find((s) => s.id === deleteStageId) ?? null;
  const leadsInStageToDelete = stageToDelete
    ? stageLeadCounts[stageToDelete.stage_key] ?? 0
    : 0;
  // Destinos possíveis: outras etapas (exclui a que está sendo removida).
  const migrationTargets = localStages.filter((s) => s.id !== deleteStageId);

  const handleChecklistTemplateChange = async (
    stage: PipelineStage,
    templateId: string | null,
  ) => {
    try {
      await updateStage.mutateAsync({
        id: stage.id,
        pipeline_type: pipelineType,
        checklist_template_id: templateId,
      });
      toast.success(
        templateId
          ? "Checklist automático configurado"
          : "Checklist automático removido",
      );
    } catch (error) {
      console.error("Error updating checklist_template_id:", error);
      toast.error("Erro ao atualizar checklist automático");
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Atualizar stages locais quando props mudar
  useEffect(() => {
    setLocalStages(stages);
  }, [stages]);

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = localStages.findIndex((s) => s.id === active.id);
      const newIndex = localStages.findIndex((s) => s.id === over.id);

      const newOrder = arrayMove(localStages, oldIndex, newIndex);
      setLocalStages(newOrder);

      // Atualizar posições no banco
      try {
        await reorderStages.mutateAsync({
          pipeline_type: pipelineType,
          stages: newOrder.map((s, i) => ({ id: s.id, position: i })),
        });
        toast.success("Ordem das etapas atualizada");
      } catch (error) {
        console.error("Error reordering stages:", error);
        toast.error("Erro ao reordenar etapas");
        setLocalStages(stages); // Reverter
      }
    }
  };

  const startEditing = (stage: PipelineStage) => {
    setEditingId(stage.id);
    setEditName(stage.name);
    setEditColor(stage.color || STAGE_COLORS[0]);
    setEditIsFinalPositive(stage.is_final_positive);
    setEditIsFinalNegative(stage.is_final_negative);
    setEditStageRole(stage.stage_role ?? "open");
    setEditTargetPipelineId(stage.target_pipeline_id || null);
    setEditTargetStageId(stage.target_stage_id || null);
    setEditTargetPipeType(stage.target_pipe_type || null);
    setEditTargetStageKey(stage.target_stage_key || null);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditName("");
    setEditColor("");
    setEditIsFinalPositive(false);
    setEditIsFinalNegative(false);
    setEditStageRole("open");
    setEditTargetPipelineId(null);
    setEditTargetStageId(null);
    setEditTargetPipeType(null);
    setEditTargetStageKey(null);
  };

  const handleSaveEdit = async () => {
    if (!editingId || !editName.trim()) return;

    try {
      await updateStage.mutateAsync({
        id: editingId,
        pipeline_type: pipelineType,
        name: editName.trim(),
        color: editColor,
        is_final_positive: editIsFinalPositive,
        is_final_negative: editIsFinalNegative,
        // Escolha explícita do admin no dropdown = confirmação humana
        // (won/lost permitido por este caminho — ADR-0017 §1).
        stage_role: editStageRole,
        // Só persiste destino em etapa de sucesso. Destino é custom XOR standard.
        target_pipe_type: editIsFinalPositive && editTargetPipeType ? editTargetPipeType : null,
        target_stage_key:
          editIsFinalPositive && editTargetPipeType && editTargetStageKey ? editTargetStageKey : null,
        target_pipeline_id: editIsFinalPositive && editTargetPipelineId ? editTargetPipelineId : null,
        target_stage_id:
          editIsFinalPositive && editTargetPipelineId && editTargetStageId ? editTargetStageId : null,
      });
      toast.success("Etapa atualizada");
      cancelEditing();
    } catch (error) {
      console.error("Error updating stage:", error);
      toast.error("Erro ao atualizar etapa");
    }
  };

  const handleCreateStage = async () => {
    if (!newStageName.trim()) return;

    try {
      await createStage.mutateAsync({
        pipeline_type: pipelineType,
        stage_key: generateStageKey(newStageName),
        name: newStageName.trim(),
        color: newStageColor,
        position: localStages.length,
        is_final_positive: newStageIsFinalPositive,
        is_final_negative: newStageIsFinalNegative,
        // Sugestão pré-preenchida do classifier OU escolha manual — em ambos
        // os casos o humano vê e salva (confirmação explícita, ADR-0017 §1).
        stage_role: newStageRole,
      });
      toast.success("Etapa criada");
      setNewStageName("");
      setNewStageColor(STAGE_COLORS[0]);
      setNewStageIsFinalPositive(false);
      setNewStageIsFinalNegative(false);
      setNewStageRoleTouched(false);
      setNewStageRoleManual("open");
      setShowNewStageForm(false);
    } catch (error: any) {
      console.error("Error creating stage:", error);
      if (error.message?.includes("duplicate")) {
        toast.error("Já existe uma etapa com esse nome");
      } else {
        toast.error("Erro ao criar etapa");
      }
    }
  };

  const handleDeleteStage = async () => {
    if (!deleteStageId || !stageToDelete) return;

    // Etapa com leads exige destino de migração (evita leads fantasmas).
    if (leadsInStageToDelete > 0 && !migrateToStageKey) {
      toast.error("Escolha uma etapa de destino para os leads antes de remover.");
      return;
    }

    try {
      await deleteStage.mutateAsync({
        id: deleteStageId,
        pipeline_type: pipelineType,
        stageKey: stageToDelete.stage_key,
        migrateToStageKey: leadsInStageToDelete > 0 ? migrateToStageKey : undefined,
      });
      toast.success(
        leadsInStageToDelete > 0
          ? `Etapa removida. ${leadsInStageToDelete} lead(s) migrado(s).`
          : "Etapa removida",
      );
      setDeleteStageId(null);
      setMigrateToStageKey("");
    } catch (error: any) {
      console.error("Error deleting stage:", error);
      toast.error(error.message || "Erro ao remover etapa");
    }
  };

  const pipelineName = getStageFamilyName(pipelineType);

  return (
    <>
          <div className="space-y-4">
            {/* Lista de etapas */}
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={localStages.map((s) => s.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-2">
                  {localStages.map((stage) => (
                    <SortableStageItem
                      key={stage.id}
                      stage={stage}
                      pipelineType={pipelineType}
                      onEdit={() => startEditing(stage)}
                      onDelete={() => setDeleteStageId(stage.id)}
                      isEditing={editingId === stage.id}
                      editName={editName}
                      editColor={editColor}
                      editIsFinalPositive={editIsFinalPositive}
                      editIsFinalNegative={editIsFinalNegative}
                      editStageRole={editStageRole}
                      editTargetPipelineId={editTargetPipelineId}
                      editTargetStageId={editTargetStageId}
                      editTargetPipeType={editTargetPipeType}
                      editTargetStageKey={editTargetStageKey}
                      onEditNameChange={setEditName}
                      onEditColorChange={setEditColor}
                      onEditIsFinalPositiveChange={setEditIsFinalPositive}
                      onEditIsFinalNegativeChange={setEditIsFinalNegative}
                      onEditStageRoleChange={setEditStageRole}
                      onEditTargetChange={(t) => {
                        setEditTargetPipelineId(t.targetPipelineId);
                        setEditTargetStageId(t.targetStageId);
                        setEditTargetPipeType(t.targetPipeType);
                        setEditTargetStageKey(t.targetStageKey);
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
              <div className="text-center py-8 text-muted-foreground">
                Nenhuma etapa encontrada
              </div>
            )}

            {/* Formulário para nova etapa */}
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
                          newStageColor === color
                            ? "border-foreground scale-110"
                            : "border-transparent hover:scale-105"
                        )}
                        style={{ backgroundColor: color }}
                        onClick={() => setNewStageColor(color)}
                      />
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="new-stage-positive"
                      checked={newStageIsFinalPositive}
                      onCheckedChange={(checked) => {
                        setNewStageIsFinalPositive(!!checked);
                        if (checked) setNewStageIsFinalNegative(false);
                      }}
                    />
                    <Label htmlFor="new-stage-positive" className="text-sm">
                      Etapa de sucesso
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="new-stage-negative"
                      checked={newStageIsFinalNegative}
                      onCheckedChange={(checked) => {
                        setNewStageIsFinalNegative(!!checked);
                        if (checked) setNewStageIsFinalPositive(false);
                      }}
                    />
                    <Label htmlFor="new-stage-negative" className="text-sm">
                      Etapa de perda
                    </Label>
                  </div>
                </div>
                <StageRoleSelect
                  value={newStageRole}
                  onChange={(role) => {
                    setNewStageRoleTouched(true);
                    setNewStageRoleManual(role);
                  }}
                  isSuggested={!newStageRoleTouched && !!newStageRoleSuggestion}
                  idSuffix="new"
                />
                <div className="flex gap-2">
                  <Button
                    onClick={handleCreateStage}
                    disabled={!newStageName.trim() || createStage.isPending}
                    className="flex-1"
                  >
                    {createStage.isPending ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Check className="w-4 h-4 mr-2" />
                    )}
                    Criar Etapa
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowNewStageForm(false);
                      setNewStageName("");
                      setNewStageRoleTouched(false);
                      setNewStageRoleManual("open");
                    }}
                  >
                    Cancelar
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => setShowNewStageForm(true)}
              >
                <Plus className="w-4 h-4 mr-2" />
                Adicionar Etapa
              </Button>
            )}
          </div>

      {/* Confirmação de exclusão */}
      <AlertDialog
        open={!!deleteStageId}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteStageId(null);
            setMigrateToStageKey("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-destructive" />
              Remover Etapa
            </AlertDialogTitle>
            <AlertDialogDescription>
              A etapa será desativada — os dados históricos são preservados e ela
              deixa de aparecer no Kanban.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {leadsInStageToDelete > 0 ? (
            <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
              <div className="flex items-start gap-2 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                <span>
                  Esta etapa tem{" "}
                  <strong>
                    {leadsInStageToDelete} lead{leadsInStageToDelete > 1 ? "s" : ""}
                  </strong>
                  . Escolha para onde migrá-los antes de remover.
                </span>
              </div>
              <Label className="text-xs text-muted-foreground">Migrar leads para:</Label>
              <Select value={migrateToStageKey} onValueChange={setMigrateToStageKey}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a etapa de destino" />
                </SelectTrigger>
                <SelectContent>
                  {migrationTargets.map((s) => (
                    <SelectItem key={s.id} value={s.stage_key}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                // Não fechar o dialog quando faltar destino — deixa o usuário escolher.
                if (leadsInStageToDelete > 0 && !migrateToStageKey) {
                  e.preventDefault();
                }
                handleDeleteStage();
              }}
              disabled={
                deleteStage.isPending ||
                (leadsInStageToDelete > 0 && !migrateToStageKey)
              }
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteStage.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : null}
              {leadsInStageToDelete > 0 ? "Migrar e remover" : "Remover"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function ManagePipelineStagesModal({
  open,
  onOpenChange,
  pipelineType,
  stages,
}: ManagePipelineStagesModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Gerenciar Etapas - {getStageFamilyName(pipelineType)}</DialogTitle>
          <DialogDescription>
            Crie, edite, reordene ou remova etapas do funil. Arraste para reordenar.
          </DialogDescription>
        </DialogHeader>
        <div className="overflow-y-auto max-h-[calc(85vh-10rem)] pr-1">
          <ManagePipelineStagesContent pipelineType={pipelineType} stages={stages} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
