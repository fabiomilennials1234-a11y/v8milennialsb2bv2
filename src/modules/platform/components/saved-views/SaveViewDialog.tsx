import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useCreateSavedView, useUpdateSavedView } from "@/modules/platform/hooks/useSavedViews";
import type { SavedView, SavedViewEntityType } from "@/types/saved-views";
import { toast } from "sonner";

interface SaveViewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityType: SavedViewEntityType;
  currentFilters: Record<string, unknown>;
  editingView?: SavedView | null;
}

export function SaveViewDialog({
  open,
  onOpenChange,
  entityType,
  currentFilters,
  editingView,
}: SaveViewDialogProps) {
  const [name, setName] = useState("");
  const [isShared, setIsShared] = useState(false);
  const createView = useCreateSavedView();
  const updateView = useUpdateSavedView();

  useEffect(() => {
    if (open && editingView) {
      setName(editingView.name);
      setIsShared(editingView.is_shared);
    } else if (open) {
      setName("");
      setIsShared(false);
    }
  }, [open, editingView]);

  const handleSave = async () => {
    if (!name.trim()) return;
    try {
      if (editingView) {
        await updateView.mutateAsync({
          id: editingView.id,
          entityType,
          name: name.trim(),
          filters: currentFilters,
          is_shared: isShared,
        });
        toast.success("View atualizada");
      } else {
        await createView.mutateAsync({
          name: name.trim(),
          entity_type: entityType,
          filters: currentFilters,
          is_shared: isShared,
        });
        toast.success("View criada");
      }
      onOpenChange(false);
    } catch {
      toast.error("Erro ao salvar view");
    }
  };

  const isPending = createView.isPending || updateView.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>
            {editingView ? "Editar View" : "Salvar View"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="view-name">Nome</Label>
            <Input
              id="view-name"
              placeholder="Ex: Meus leads quentes"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && name.trim()) handleSave();
              }}
              autoFocus
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="view-shared">Compartilhar com time</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Todos da organização poderão ver esta view
              </p>
            </div>
            <Switch
              id="view-shared"
              checked={isShared}
              onCheckedChange={setIsShared}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={!name.trim() || isPending}>
            {isPending ? "Salvando..." : editingView ? "Atualizar" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
