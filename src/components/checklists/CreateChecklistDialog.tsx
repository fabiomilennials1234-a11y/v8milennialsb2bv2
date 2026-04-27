import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCreateChecklist } from "@/hooks/useChecklists";
import { useLeads } from "@/hooks/useLeads";

export function CreateChecklistDialog() {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [leadId, setLeadId] = useState<string>("");

  const createChecklist = useCreateChecklist();
  const { data: leadsData } = useLeads();
  const leads = leadsData ?? [];

  const handleCreate = () => {
    const trimmed = title.trim();
    if (!trimmed) return;

    createChecklist.mutate(
      {
        title: trimmed,
        description: description.trim() || undefined,
        lead_id: leadId || undefined,
      },
      {
        onSuccess: () => {
          setTitle("");
          setDescription("");
          setLeadId("");
          setOpen(false);
        },
      }
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && title.trim()) {
      e.preventDefault();
      handleCreate();
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-2">
          <Plus className="w-4 h-4" />
          Novo Checklist
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Novo Checklist</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="checklist-title">Título *</Label>
            <Input
              id="checklist-title"
              placeholder="Nome do checklist"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="checklist-desc">Descrição</Label>
            <Textarea
              id="checklist-desc"
              placeholder="Descrição opcional..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label>Lead (opcional)</Label>
            <Select value={leadId} onValueChange={(v) => setLeadId(v === "__none__" ? "" : v)}>
              <SelectTrigger>
                <SelectValue placeholder="Nenhum lead vinculado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Nenhum</SelectItem>
                {leads.map((lead: any) => (
                  <SelectItem key={lead.id} value={lead.id}>
                    {lead.name}{lead.company ? ` — ${lead.company}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!title.trim() || createChecklist.isPending}
            >
              {createChecklist.isPending ? "Criando..." : "Criar"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
