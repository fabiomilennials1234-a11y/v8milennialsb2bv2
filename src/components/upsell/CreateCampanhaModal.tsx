import { useState } from "react";
import { Target } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCreateUpsellCampanha } from "@/hooks/useUpsellCampanhas";
import { useUpsellClients } from "@/hooks/useUpsellClients";
import { useOrganization } from "@/hooks/useOrganization";
import { useTeamMembers } from "@/hooks/useTeamMembers";
import { toast } from "sonner";

interface CreateCampanhaModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateCampanhaModal({ open, onOpenChange }: CreateCampanhaModalProps) {
  const { organizationId } = useOrganization();
  const createCampanha = useCreateUpsellCampanha();
  const { data: clients = [] } = useUpsellClients();
  const { data: teamMembers = [] } = useTeamMembers();

  const activeClients = clients.filter((c) => c.is_active);

  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    client_id: "",
    responsible_id: "",
    mrr_planejado: "",
    projeto_planejado: "",
    notes: "",
  });

  const selectedClient = activeClients.find((c) => c.id === formData.client_id);

  const handleSubmit = async () => {
    if (!organizationId || !formData.client_id) {
      toast.error("Selecione um cliente");
      return;
    }

    try {
      await createCampanha.mutateAsync({
        organization_id: organizationId,
        client_id: formData.client_id,
        responsible_id: formData.responsible_id || null,
        mrr_planejado: formData.mrr_planejado ? parseFloat(formData.mrr_planejado) : 0,
        projeto_planejado: formData.projeto_planejado ? parseFloat(formData.projeto_planejado) : 0,
        notes: formData.notes || null,
        status: "cliente",
      });

      toast.success("Campanha criada!");
      onOpenChange(false);
      setStep(1);
      setFormData({ client_id: "", responsible_id: "", mrr_planejado: "", projeto_planejado: "", notes: "" });
    } catch (err: any) {
      toast.error("Erro ao criar campanha: " + (err?.message || ""));
    }
  };

  const handleClose = () => {
    onOpenChange(false);
    setStep(1);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-purple-500/10">
              <Target className="w-4 h-4 text-purple-600" />
            </div>
            Nova Campanha Upsell
          </DialogTitle>
          <DialogDescription>Passo {step} de 3</DialogDescription>
        </DialogHeader>

        <div className="py-4">
          {step === 1 && (
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label>Selecionar Cliente</Label>
                <Select value={formData.client_id} onValueChange={(v) => setFormData((prev) => ({ ...prev, client_id: v }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione um cliente..." />
                  </SelectTrigger>
                  <SelectContent>
                    {activeClients.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} {c.company ? `- ${c.company}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {selectedClient && (
                <div className="text-sm text-muted-foreground p-3 bg-muted rounded-lg">
                  <p><strong>Potencial:</strong> {selectedClient.potencial}</p>
                  {selectedClient.company && <p><strong>Empresa:</strong> {selectedClient.company}</p>}
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label>Responsável</Label>
                <Select
                  value={formData.responsible_id || "none"}
                  onValueChange={(v) => setFormData((prev) => ({ ...prev, responsible_id: v === "none" ? "" : v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nenhum</SelectItem>
                    {teamMembers.map((m) => (
                      <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>MRR Planejado (R$)</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={formData.mrr_planejado}
                    onChange={(e) => setFormData((prev) => ({ ...prev, mrr_planejado: e.target.value }))}
                    placeholder="0"
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Projeto Planejado (R$)</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={formData.projeto_planejado}
                    onChange={(e) => setFormData((prev) => ({ ...prev, projeto_planejado: e.target.value }))}
                    placeholder="0"
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label>Observacoes</Label>
                <Textarea
                  value={formData.notes}
                  onChange={(e) => setFormData((prev) => ({ ...prev, notes: e.target.value }))}
                  rows={2}
                />
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3 text-sm">
              <h4 className="font-medium">Confirmar Campanha</h4>
              <div className="p-3 bg-muted rounded-lg space-y-1">
                <p><strong>Cliente:</strong> {selectedClient?.name}</p>
                <p><strong>Responsável:</strong> {teamMembers.find((m) => m.id === formData.responsible_id)?.name || "Nenhum"}</p>
                <p><strong>MRR Planejado:</strong> R$ {formData.mrr_planejado || "0"}</p>
                <p><strong>Projeto Planejado:</strong> R$ {formData.projeto_planejado || "0"}</p>
                {formData.notes && <p><strong>Notas:</strong> {formData.notes}</p>}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          {step > 1 && (
            <Button variant="outline" onClick={() => setStep((s) => s - 1)}>Voltar</Button>
          )}
          {step < 3 ? (
            <Button onClick={() => setStep((s) => s + 1)} disabled={step === 1 && !formData.client_id}>
              Proximo
            </Button>
          ) : (
            <Button onClick={handleSubmit} disabled={createCampanha.isPending}>
              {createCampanha.isPending ? "Criando..." : "Criar Campanha"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
