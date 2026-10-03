import { useState } from "react";
import { ListChecks, Plus } from "lucide-react";
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
import { useChecklistTemplates } from "@/modules/engagement/hooks/useChecklistTemplates";
import { useCreateChecklist } from "@/modules/engagement/hooks/useChecklists";
import { useIdentity } from "@/modules/identity";
import { ChecklistCard } from "./ChecklistCard";
import { toast } from "sonner";

export function ChecklistTemplatesManager() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const { data: templates = [], isLoading } = useChecklistTemplates();
  const createChecklist = useCreateChecklist();
  const { isAdmin } = useIdentity();

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
          <h3 className="text-base font-bold tracking-tight">Templates de Checklist</h3>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Crie templates reutilizáveis para aplicar nos leads
          </p>
        </div>
        {isAdmin && (
          <Button onClick={() => setDialogOpen(true)}>
            <Plus />
            Novo Template
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-[86px] animate-pulse rounded-card bg-muted" />
          ))}
        </div>
      ) : templates.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border px-6 py-10 text-center">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-muted text-muted-foreground">
            <ListChecks className="h-5 w-5" />
          </span>
          <p className="text-sm font-semibold">Nenhum template cadastrado</p>
        </div>
      ) : (
        // Aqui o template já mora dentro do cartão de Configurações: sem a
        // sombra do bento, para não virar cartão-sobre-cartão.
        <div className="space-y-3 [&>div]:shadow-none">
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
