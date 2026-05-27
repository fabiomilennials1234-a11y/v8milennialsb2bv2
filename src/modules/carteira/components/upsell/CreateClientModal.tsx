import { useState } from "react";
import { UserPlus } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreateUpsellClient } from "@/modules/carteira/hooks/useUpsellClients";
import { useOrganization } from "@/modules/identity";
import { usePipelineStages } from "@/modules/pipelines/hooks/usePipelineStages";
import { useResponsibleMembers } from "@/modules/identity";
import { useLeads } from "@/modules/leads";
import { toast } from "sonner";

interface CreateClientModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateClientModal({ open, onOpenChange }: CreateClientModalProps) {
  const { organizationId } = useOrganization();
  const createClient = useCreateUpsellClient();
  const responsibleMembers = useResponsibleMembers();
  const { data: leads = [] } = useLeads();
  const { data: baseStages = [] } = usePipelineStages("upsell_base");
  const defaultBaseStageKey = baseStages.find(s => s.position === 0)?.stage_key || baseStages[0]?.stage_key || "0-3m";

  const [formData, setFormData] = useState({
    lead_id: "",
    name: "",
    company: "",
    email: "",
    phone: "",
    potencial: "medio" as "baixo" | "medio" | "alto" | "estrategico",
    responsible_id: "" as string,
    first_sale_at: new Date().toISOString().split("T")[0],
  });

  const selectedLead = leads.find((l) => l.id === formData.lead_id);

  const handleLeadChange = (leadId: string) => {
    const lead = leads.find((l) => l.id === leadId);
    if (lead) {
      setFormData((prev) => ({
        ...prev,
        lead_id: leadId,
        name: lead.name || "",
        company: lead.company || "",
        email: lead.email || "",
        phone: lead.phone || "",
        responsible_id: lead.responsible_id || prev.responsible_id,
      }));
    }
  };

  const handleSubmit = async () => {
    if (!organizationId || !formData.lead_id || !formData.name) {
      toast.error("Selecione um lead e preencha o nome");
      return;
    }

    try {
      await createClient.mutateAsync({
        organization_id: organizationId,
        lead_id: formData.lead_id,
        name: formData.name,
        company: formData.company || null,
        email: formData.email || null,
        phone: formData.phone || null,
        potencial: formData.potencial,
        responsible_id: formData.responsible_id || null,
        first_sale_at: new Date(formData.first_sale_at).toISOString(),
        tipo_cliente_tempo: defaultBaseStageKey,
      });
      toast.success("Cliente adicionado a base");
      onOpenChange(false);
      setFormData({
        lead_id: "",
        name: "",
        company: "",
        email: "",
        phone: "",
        potencial: "medio",
        responsible_id: "",
        first_sale_at: new Date().toISOString().split("T")[0],
      });
    } catch (err: any) {
      if (err?.code === "23505") {
        toast.error("Este lead ja e um cliente na base");
      } else {
        toast.error("Erro ao criar cliente: " + (err?.message || ""));
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-primary/10">
              <UserPlus className="w-4 h-4 text-primary" />
            </div>
            Novo Cliente
          </DialogTitle>
          <DialogDescription>Adicione um cliente a base de upsell</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4 overflow-y-auto flex-1 pr-1">
          <div className="grid gap-2">
            <Label>Selecionar Lead</Label>
            <Select value={formData.lead_id} onValueChange={handleLeadChange}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione um lead..." />
              </SelectTrigger>
              <SelectContent>
                {leads.map((lead) => (
                  <SelectItem key={lead.id} value={lead.id}>
                    {lead.name} {lead.company ? `- ${lead.company}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Nome</Label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
              />
            </div>
            <div className="grid gap-2">
              <Label>Empresa</Label>
              <Input
                value={formData.company}
                onChange={(e) => setFormData((prev) => ({ ...prev, company: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Email</Label>
              <Input
                value={formData.email}
                onChange={(e) => setFormData((prev) => ({ ...prev, email: e.target.value }))}
              />
            </div>
            <div className="grid gap-2">
              <Label>Telefone</Label>
              <Input
                value={formData.phone}
                onChange={(e) => setFormData((prev) => ({ ...prev, phone: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Potencial</Label>
              <Select
                value={formData.potencial}
                onValueChange={(v) => setFormData((prev) => ({ ...prev, potencial: v as any }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="baixo">Baixo</SelectItem>
                  <SelectItem value="medio">Medio</SelectItem>
                  <SelectItem value="alto">Alto</SelectItem>
                  <SelectItem value="estrategico">Estrategico</SelectItem>
                </SelectContent>
              </Select>
            </div>
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
                  {responsibleMembers.map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Data da Primeira Venda</Label>
            <Input
              type="date"
              value={formData.first_sale_at}
              onChange={(e) => setFormData((prev) => ({ ...prev, first_sale_at: e.target.value }))}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={createClient.isPending}>
            {createClient.isPending ? "Salvando..." : "Criar Cliente"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
