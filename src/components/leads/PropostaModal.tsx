import { useState } from "react";
import { Calendar, Clock, DollarSign, Package } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTeamMembers } from "@/hooks/useTeamMembers";
import { useUpdatePipeProposta, PipePropostasStatus } from "@/hooks/usePipePropostas";
import { toast } from "sonner";
import { format } from "date-fns";

const statusLabels: Record<PipePropostasStatus, string> = {
  marcar_compromisso: "Marcar Compromisso",
  reativar: "Reativar",
  compromisso_marcado: "Compromisso Marcado",
  esfriou: "Esfriou",
  futuro: "Futuro",
  vendido: "Vendido ✓",
  perdido: "Perdido",
};

const productTypeLabels: Record<string, string> = {
  mrr: "MRR (Recorrente)",
  projeto: "Projeto (Único)",
};

interface PropostaModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  proposta: any;
  onSuccess?: () => void;
}

export function PropostaModal({ 
  open, 
  onOpenChange, 
  proposta,
  onSuccess
}: PropostaModalProps) {
  const [formData, setFormData] = useState({
    status: proposta?.status || "marcar_compromisso",
    product_type: proposta?.product_type || "",
    sale_value: proposta?.sale_value || "",
    contract_duration: proposta?.contract_duration || "",
    closer_id: proposta?.closer_id || null,
    commitment_date: proposta?.commitment_date 
      ? format(new Date(proposta.commitment_date), "yyyy-MM-dd'T'HH:mm")
      : "",
    notes: proposta?.notes || "",
  });

  const { data: teamMembers = [] } = useTeamMembers();
  const updateProposta = useUpdatePipeProposta();

  const closers = teamMembers.filter(m => m.role === "closer" && m.is_active);

  const handleSubmit = async () => {
    try {
      await updateProposta.mutateAsync({
        id: proposta.id,
        status: formData.status as PipePropostasStatus,
        product_type: formData.product_type as any || null,
        sale_value: formData.sale_value ? Number(formData.sale_value) : null,
        contract_duration: formData.contract_duration ? Number(formData.contract_duration) : null,
        closer_id: formData.closer_id || null,
        commitment_date: formData.commitment_date ? new Date(formData.commitment_date).toISOString() : null,
        notes: formData.notes || null,
        closed_at: formData.status === "vendido" ? new Date().toISOString() : null,
      });
      
      toast.success("Proposta atualizada!");
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      toast.error("Erro ao atualizar proposta");
      console.error(error);
    }
  };

  const lead = proposta?.lead;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="w-5 h-5 text-primary" />
            Editar Proposta
          </DialogTitle>
        </DialogHeader>

        {/* Lead Info */}
        {lead && (
          <div className="p-3 bg-muted/50 rounded-lg mb-4">
            <p className="font-medium">{lead.name}</p>
            {lead.company && (
              <p className="text-sm text-muted-foreground">{lead.company}</p>
            )}
          </div>
        )}

        <div className="space-y-4">
          <div className="grid gap-2">
            <Label>Status</Label>
            <Select
              value={formData.status}
              onValueChange={(v) => setFormData({ ...formData, status: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(statusLabels).map(([key, label]) => (
                  <SelectItem key={key} value={key}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Tipo de Produto</Label>
              <Select
                value={formData.product_type || "none"}
                onValueChange={(v) => setFormData({ ...formData, product_type: v === "none" ? "" : v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecionar" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">-</SelectItem>
                  {Object.entries(productTypeLabels).map(([key, label]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Closer</Label>
              <Select
                value={formData.closer_id || "none"}
                onValueChange={(v) => setFormData({ ...formData, closer_id: v === "none" ? null : v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecionar" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhum</SelectItem>
                  {closers.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="sale_value">Valor da Venda (R$)</Label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="sale_value"
                  type="number"
                  value={formData.sale_value}
                  onChange={(e) => setFormData({ ...formData, sale_value: e.target.value })}
                  placeholder="10000"
                  className="pl-9"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="duration">Duração (meses)</Label>
              <div className="relative">
                <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="duration"
                  type="number"
                  value={formData.contract_duration}
                  onChange={(e) => setFormData({ ...formData, contract_duration: e.target.value })}
                  placeholder="12"
                  className="pl-9"
                />
              </div>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="commitment_date">Data do Compromisso</Label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="commitment_date"
                type="datetime-local"
                value={formData.commitment_date}
                onChange={(e) => setFormData({ ...formData, commitment_date: e.target.value })}
                className="pl-9"
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="notes">Observações</Label>
            <Textarea
              id="notes"
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder="Anotações sobre a proposta..."
              rows={3}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button 
            onClick={handleSubmit} 
            disabled={updateProposta.isPending}
          >
            Salvar Alterações
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
