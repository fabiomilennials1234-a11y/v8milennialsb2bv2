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
  PipelineStage,
  PipelineType,
  useCreatePipelineStage,
  useUpdatePipelineStage,
  useDeletePipelineStage,
  useReorderPipelineStages,
  getPipelineTypeName,
} from "@/hooks/usePipelineStages";
import {
  Plus,
  Trash2,
  GripVertical,
  Pencil,
  Check,
  X,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
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
  pipelineType: PipelineType;
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
  onEdit,
  onDelete,
  isEditing,
  editName,
  editColor,
  editIsFinalPositive,
  editIsFinalNegative,
  onEditNameChange,
  onEditColorChange,
  onEditIsFinalPositiveChange,
  onEditIsFinalNegativeChange,
  onSaveEdit,
  onCancelEdit,
  isSaving,
}: {
  stage: PipelineStage;
  onEdit: () => void;
  onDelete: () => void;
  isEditing: boolean;
  editName: string;
  editColor: string;
  editIsFinalPositive: boolean;
  editIsFinalNegative: boolean;
  onEditNameChange: (name: string) => void;
  onEditColorChange: (color: string) => void;
  onEditIsFinalPositiveChange: (value: boolean) => void;
  onEditIsFinalNegativeChange: (value: boolean) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  isSaving: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: stage.id });

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
        </div>
      ) : (
        <>
          <div
            className="w-4 h-4 rounded-full shrink-0"
            style={{ backgroundColor: stage.color || "#64748b" }}
          />
          <div className="flex-1">
            <span className="font-medium">{stage.name}</span>
            {stage.is_final_positive && (
              <span className="ml-2 text-xs text-green-600 bg-green-100 px-2 py-0.5 rounded">
                Sucesso
              </span>
            )}
            {stage.is_final_negative && (
              <span className="ml-2 text-xs text-red-600 bg-red-100 px-2 py-0.5 rounded">
                Perda
              </span>
            )}
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

export function ManagePipelineStagesModal({
  open,
  onOpenChange,
  pipelineType,
  stages,
}: ManagePipelineStagesModalProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");
  const [editIsFinalPositive, setEditIsFinalPositive] = useState(false);
  const [editIsFinalNegative, setEditIsFinalNegative] = useState(false);
  const [newStageName, setNewStageName] = useState("");
  const [newStageColor, setNewStageColor] = useState(STAGE_COLORS[0]);
  const [newStageIsFinalPositive, setNewStageIsFinalPositive] = useState(false);
  const [newStageIsFinalNegative, setNewStageIsFinalNegative] = useState(false);
  const [showNewStageForm, setShowNewStageForm] = useState(false);
  const [deleteStageId, setDeleteStageId] = useState<string | null>(null);
  const [localStages, setLocalStages] = useState<PipelineStage[]>(stages);

  const createStage = useCreatePipelineStage();
  const updateStage = useUpdatePipelineStage();
  const deleteStage = useDeletePipelineStage();
  const reorderStages = useReorderPipelineStages();

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
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditName("");
    setEditColor("");
    setEditIsFinalPositive(false);
    setEditIsFinalNegative(false);
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
      });
      toast.success("Etapa criada");
      setNewStageName("");
      setNewStageColor(STAGE_COLORS[0]);
      setNewStageIsFinalPositive(false);
      setNewStageIsFinalNegative(false);
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
    if (!deleteStageId) return;

    try {
      await deleteStage.mutateAsync({
        id: deleteStageId,
        pipeline_type: pipelineType,
      });
      toast.success("Etapa removida");
      setDeleteStageId(null);
    } catch (error: any) {
      console.error("Error deleting stage:", error);
      toast.error(error.message || "Erro ao remover etapa");
    }
  };

  const pipelineName = getPipelineTypeName(pipelineType);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Gerenciar Etapas - {pipelineName}</DialogTitle>
            <DialogDescription>
              Crie, edite, reordene ou remova etapas do funil. Arraste para reordenar.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-4">
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
                      onEdit={() => startEditing(stage)}
                      onDelete={() => setDeleteStageId(stage.id)}
                      isEditing={editingId === stage.id}
                      editName={editName}
                      editColor={editColor}
                      editIsFinalPositive={editIsFinalPositive}
                      editIsFinalNegative={editIsFinalNegative}
                      onEditNameChange={setEditName}
                      onEditColorChange={setEditColor}
                      onEditIsFinalPositiveChange={setEditIsFinalPositive}
                      onEditIsFinalNegativeChange={setEditIsFinalNegative}
                      onSaveEdit={handleSaveEdit}
                      onCancelEdit={cancelEditing}
                      isSaving={updateStage.isPending}
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
        </DialogContent>
      </Dialog>

      {/* Confirmação de exclusão */}
      <AlertDialog open={!!deleteStageId} onOpenChange={() => setDeleteStageId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-destructive" />
              Remover Etapa
            </AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja remover esta etapa? A etapa será desativada mas os dados históricos serão preservados.
              <br />
              <br />
              <strong>Atenção:</strong> Leads que estão nesta etapa continuarão com o status atual, mas a etapa não aparecerá mais no Kanban.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteStage}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteStage.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : null}
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
