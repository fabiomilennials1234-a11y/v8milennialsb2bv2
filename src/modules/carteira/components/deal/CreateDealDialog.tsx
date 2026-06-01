import { useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { useCreateDeal } from "@/modules/carteira/hooks/useDeals";
import { useOrganization } from "@/modules/identity";
import { useTeamMembers } from "@/modules/identity";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateDealDialog({ open, onOpenChange }: Props) {
  const { organizationId } = useOrganization();
  const createDeal = useCreateDeal();
  const { data: teamMembers } = useTeamMembers();

  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const [probability, setProbability] = useState("50");
  const [ownerId, setOwnerId] = useState<string>("");
  const [expectedClose, setExpectedClose] = useState("");
  const [notes, setNotes] = useState("");

  const handleSubmit = () => {
    if (!title.trim() || !organizationId) return;

    createDeal.mutate(
      {
        title: title.trim(),
        value: parseFloat(value) || 0,
        probability: parseInt(probability) || 50,
        owner_id: ownerId || null,
        expected_close_date: expectedClose || null,
        notes: notes.trim() || null,
        organization_id: organizationId,
      },
      {
        onSuccess: () => {
          onOpenChange(false);
          setTitle("");
          setValue("");
          setProbability("50");
          setOwnerId("");
          setExpectedClose("");
          setNotes("");
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Novo negócio</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="deal-title">Título</Label>
            <Input
              id="deal-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: Contrato Empresa ABC"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="deal-value">Valor (R$)</Label>
              <Input
                id="deal-value"
                type="number"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="0,00"
                min={0}
                step={0.01}
              />
            </div>
            <div>
              <Label htmlFor="deal-probability">Probabilidade (%)</Label>
              <Input
                id="deal-probability"
                type="number"
                value={probability}
                onChange={(e) => setProbability(e.target.value)}
                min={0}
                max={100}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Responsável</Label>
              <Select value={ownerId} onValueChange={setOwnerId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecionar" />
                </SelectTrigger>
                <SelectContent>
                  {(teamMembers ?? []).map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="deal-close">Previsão fechamento</Label>
              <Input
                id="deal-close"
                type="date"
                value={expectedClose}
                onChange={(e) => setExpectedClose(e.target.value)}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="deal-notes">Notas</Label>
            <Textarea
              id="deal-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Observações sobre o negócio"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={!title.trim() || createDeal.isPending}>
            {createDeal.isPending ? "Criando..." : "Criar negócio"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
