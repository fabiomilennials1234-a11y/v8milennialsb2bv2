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
import { useUpdateCampanha, useCampanhaMembers, useUpdateCampanhaMember, type Campanha, type LeadDistributionMode, type CampanhaMemberRole } from "@/modules/campaigns/hooks/useCampanhas";
import { useCopilotAgents } from "@/modules/copilot/hooks/useCopilotAgents";
import { useTeamMembers } from "@/modules/identity";
import { useWhatsAppInstances } from "@/modules/communication/hooks/useWhatsAppInstances";
import { toast } from "sonner";
import { AlertTriangle, Bot, Shuffle, User, Users } from "lucide-react";

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
  const [closerDistributionMode, setCloserDistributionMode] = useState<LeadDistributionMode>(null);
  const [closerAssignedTo, setCloserAssignedTo] = useState<string | null>(null);
  const [whatsappInstanceId, setWhatsappInstanceId] = useState<string | null>(null);

  const updateCampanha = useUpdateCampanha();
  const updateMember = useUpdateCampanhaMember();
  const { data: agents } = useCopilotAgents();
  const { data: teamMembers } = useTeamMembers();
  const { data: whatsappInstances = [] } = useWhatsAppInstances();
  const { data: campanhaMembers = [] } = useCampanhaMembers(campanha?.id);
  const allCampanhaMembers = campanhaMembers;
  const needsMembers =
    (leadDistributionMode === "round_robin" || leadDistributionMode === "random") && allCampanhaMembers.length === 0;
  const needsCloserMembers =
    (closerDistributionMode === "round_robin" || closerDistributionMode === "random") && allCampanhaMembers.length === 0;

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
      setLeadDistributionMode(campanha.lead_distribution_mode ?? null);
      setLeadAssignedTo(campanha.lead_assigned_to ?? null);
      setCloserDistributionMode(campanha.closer_distribution_mode ?? null);
      setCloserAssignedTo(campanha.closer_assigned_to ?? null);
      setWhatsappInstanceId(campanha.whatsapp_instance_id ?? null);
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
        closer_distribution_mode: closerDistributionMode,
        closer_assigned_to: closerDistributionMode === "single" ? closerAssignedTo : null,
        ...((campanha.campaign_type === "automatica" || campanha.campaign_type === "semi_automatica") && { whatsapp_instance_id: whatsappInstanceId }),
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
      <DialogContent className="sm:max-w-[480px] max-h-[90vh] overflow-y-auto">
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
          {(campanha.campaign_type === "automatica" || campanha.campaign_type === "semi_automatica") && (
            <div className="space-y-2">
              <Label>Instância WhatsApp (opcional)</Label>
              <Select
                value={whatsappInstanceId ?? "none"}
                onValueChange={(v) => setWhatsappInstanceId(v === "none" ? null : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Usar primeira instância ativa" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Usar primeira instância ativa</SelectItem>
                  {whatsappInstances.map((inst) => (
                    <SelectItem key={inst.id} value={inst.id}>
                      {inst.instance_name}
                      {inst.phone_number ? ` (${inst.phone_number})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {/* Membros da Campanha - Role Management */}
          {campanhaMembers.length > 0 && (
            <div className="space-y-3 pt-4 border-t">
              <Label className="flex items-center gap-2">
                <Users className="w-4 h-4" />
                Membros da Campanha — Papel
              </Label>
              <p className="text-xs text-muted-foreground">
                Defina o papel de cada membro. A distribuição automática usa esses papéis.
              </p>
              <div className="space-y-2">
                {campanhaMembers.map((m) => (
                  <div key={m.team_member_id} className="flex items-center gap-2">
                    <span className="text-sm flex-1 truncate">
                      {m.team_member?.name}
                    </span>
                    <Select
                      value={m.role}
                      onValueChange={(v) => {
                        updateMember.mutate({
                          campanha_id: campanha!.id,
                          team_member_id: m.team_member_id,
                          role: v as CampanhaMemberRole,
                        });
                      }}
                    >
                      <SelectTrigger className="w-[120px] h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="sdr">Qualificação</SelectItem>
                        <SelectItem value="closer">Propostas</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Distribuição de vendedores (qualificação) */}
          <div className="space-y-3 pt-4 border-t">
            <Label className="flex items-center gap-2">
              <Shuffle className="w-4 h-4" />
              Distribuição de Vendedores (Qualificação)
            </Label>
            <Select
              value={leadDistributionMode ?? "none"}
              onValueChange={(v) => {
                setLeadDistributionMode(v === "none" ? null : (v as LeadDistributionMode));
                if (v !== "single") setLeadAssignedTo(null);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Como distribuir vendedores" />
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
                  {allCampanhaMembers.length > 0 ? allCampanhaMembers.map((m) => (
                    <SelectItem key={m.team_member_id} value={m.team_member_id}>
                      <span className="flex items-center gap-2">
                        <User className="w-3 h-3" />
                        {m.team_member?.name}
                      </span>
                    </SelectItem>
                  )) : teamMembers?.map((m) => (
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
            {needsMembers && (
              <p className="text-sm text-amber-600 dark:text-amber-500 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                Adicione membros para a distribuição funcionar.
              </p>
            )}
          </div>

          {/* Distribuição de vendedores (propostas) */}
          <div className="space-y-3 pt-4 border-t">
            <Label className="flex items-center gap-2">
              <Shuffle className="w-4 h-4" />
              Distribuição de Vendedores (Propostas)
            </Label>
            <Select
              value={closerDistributionMode ?? "none"}
              onValueChange={(v) => {
                setCloserDistributionMode(v === "none" ? null : (v as LeadDistributionMode));
                if (v !== "single") setCloserAssignedTo(null);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Como distribuir vendedores" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Manual</SelectItem>
                <SelectItem value="random">Aleatório</SelectItem>
                <SelectItem value="round_robin">Rotativo</SelectItem>
                <SelectItem value="single">Pessoa específica</SelectItem>
              </SelectContent>
            </Select>
            {closerDistributionMode === "single" && (
              <Select value={closerAssignedTo ?? ""} onValueChange={(v) => setCloserAssignedTo(v || null)}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o vendedor" />
                </SelectTrigger>
                <SelectContent>
                  {allCampanhaMembers.length > 0 ? allCampanhaMembers.map((m) => (
                    <SelectItem key={m.team_member_id} value={m.team_member_id}>
                      <span className="flex items-center gap-2">
                        <User className="w-3 h-3" />
                        {m.team_member?.name}
                      </span>
                    </SelectItem>
                  )) : teamMembers?.map((m) => (
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
            {needsCloserMembers && (
              <p className="text-sm text-amber-600 dark:text-amber-500 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                Adicione membros para a distribuição funcionar.
              </p>
            )}
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
