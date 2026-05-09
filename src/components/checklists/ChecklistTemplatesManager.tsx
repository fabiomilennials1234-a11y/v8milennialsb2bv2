import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useChecklistTemplates } from "@/hooks/useChecklistTemplates";
import { useCreateChecklist } from "@/hooks/useChecklists";
import { useIsAdmin } from "@/hooks/useUserRole";
import { ChecklistCard } from "./ChecklistCard";
import { toast } from "sonner";

export function ChecklistTemplatesManager() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const { data: templates = [], isLoading } = useChecklistTemplates();
  const createChecklist = useCreateChecklist();
  const { isAdmin } = useIsAdmin();

  const handleCreate = async () => {
    const trimmed = title.trim();
    if (!trimmed) {
      toast.error("Nome do template obrigatório");
      return;
    }

    try {
      await createChecklist.mutateAsync({
        title: trimmed,
        description: description.trim() || undefined,
      });
      setDialogOpen(false);
      setTitle("");
      setDescription("");
    } catch {
      // toast handled by hook
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">Templates de Checklist</h3>
          <p className="text-sm text-muted-foreground">
            Crie templates reutilizáveis para aplicar nos leads
          </p>
        </div>
        {isAdmin && (
          <Button onClick={() => setDialogOpen(true)} size="sm" className="gap-2">
            <Plus className="w-4 h-4" />
            Novo Template
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 bg-muted animate-pulse rounded-xl" />
          ))}
        </div>
      ) : templates.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground border border-dashed rounded-lg">
          Nenhum template cadastrado
        </div>
      ) : (
        <div className="space-y-3">
          {templates.map((t) => (
            <ChecklistCard key={t.id} checklist={t} />
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo Template de Checklist</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="tpl-title">Nome</Label>
              <Input
                id="tpl-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex: Onboarding Novo Cliente"
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="tpl-desc">Descrição (opcional)</Label>
              <Textarea
                id="tpl-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Passos padrão para onboarding..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleCreate} disabled={createChecklist.isPending}>
              Criar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
