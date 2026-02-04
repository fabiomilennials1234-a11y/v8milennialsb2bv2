import { useEffect, useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useUpdateCampanha, type Campanha, type LeadDistributionMode } from "@/hooks/useCampanhas";
import { useCopilotAgents } from "@/hooks/useCopilotAgents";
import { useTeamMembers } from "@/hooks/useTeamMembers";
import { toast } from "sonner";
import { Bot, Shuffle, User } from "lucide-react";

interface EditCampanhaModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campanha: Campanha | null;
}

export function EditCampanhaModal({
  open,
  onOpenChange,
  campanha,
}: EditCampanhaModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [agentId, setAgentId] = useState<string | null>(null);
  const [leadDistributionMode, setLeadDistributionMode] = useState<LeadDistributionMode>(null);
  const [leadAssignedTo, setLeadAssignedTo] = useState<string | null>(null);

  const updateCampanha = useUpdateCampanha();
  const { data: agents } = useCopilotAgents();
  const { data: teamMembers } = useTeamMembers();

  const outboundAgents =
    agents?.filter(
      (a) =>
        a.is_active &&
        (a.operation_mode === "outbound" || a.operation_mode === "hybrid")
    ) ?? [];

  useEffect(() => {
    if (campanha) {
      setName(campanha.name);
      setDescription(campanha.description ?? "");
      setAgentId(campanha.agent_id ?? null);
      setLeadDistributionMode((campanha as any).lead_distribution_mode ?? null);
      setLeadAssignedTo((campanha as any).lead_assigned_to ?? null);
    }
  }, [campanha, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!campanha) return;

    try {
      await updateCampanha.mutateAsync({
        id: campanha.id,
        name: name.trim(),
        description: description.trim() || null,
        ...(campanha.campaign_type === "automatica" && { agent_id: agentId }),
        lead_distribution_mode: leadDistributionMode,
        lead_assigned_to: leadDistributionMode === "single" ? leadAssignedTo : null,
      });
      toast.success("Campanha atualizada");
      onOpenChange(false);
    } catch (error) {
      console.error("Error updating campaign:", error);
      toast.error("Erro ao atualizar campanha");
    }
  };

  if (!campanha) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Editar campanha</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-name">Nome</Label>
            <Input
              id="edit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nome da campanha"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-description">Descrição (opcional)</Label>
            <Textarea
              id="edit-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Descrição da campanha"
              rows={2}
              className="resize-none"
            />
          </div>
          {/* Distribuição de leads */}
          <div className="space-y-3 pt-4 border-t">
            <Label className="flex items-center gap-2">
              <Shuffle className="w-4 h-4" />
              Distribuição de leads
            </Label>
            <Select
              value={leadDistributionMode ?? "none"}
              onValueChange={(v) => {
                setLeadDistributionMode(v === "none" ? null : (v as LeadDistributionMode));
                if (v !== "single") setLeadAssignedTo(null);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Como distribuir leads" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Manual (definir na importação)</SelectItem>
                <SelectItem value="random">Aleatório</SelectItem>
                <SelectItem value="round_robin">Rotativo</SelectItem>
                <SelectItem value="single">Pessoa específica</SelectItem>
              </SelectContent>
            </Select>
            {leadDistributionMode === "single" && (
              <Select value={leadAssignedTo ?? ""} onValueChange={(v) => setLeadAssignedTo(v || null)}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o vendedor" />
                </SelectTrigger>
                <SelectContent>
                  {teamMembers?.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      <span className="flex items-center gap-2">
                        <User className="w-3 h-3" />
                        {m.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <p className="text-xs text-muted-foreground">
              Aplica a leads importados e integrações (Meta Ads, webhooks, etc.)
            </p>
          </div>

          {campanha.campaign_type === "automatica" && (
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Bot className="w-4 h-4" />
                Copilot
              </Label>
              <Select
                value={agentId ?? "none"}
                onValueChange={(v) => setAgentId(v === "none" ? null : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecionar agente" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhum</SelectItem>
                  {outboundAgents.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agent.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                O agente envia mensagens e conversa com os leads desta campanha.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={updateCampanha.isPending}>
              {updateCampanha.isPending ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
