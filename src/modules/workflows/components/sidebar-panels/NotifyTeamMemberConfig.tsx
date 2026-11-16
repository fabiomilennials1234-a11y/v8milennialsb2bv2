import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useTeamMembers } from "@/modules/identity";
import type { ActionNodeData } from "@/types/workflow";
import { InstanceRoutingSelector } from "./InstanceRoutingSelector";

export function NotifyTeamMemberConfig({ data, onUpdate }: {
  data: ActionNodeData;
  onUpdate: (updates: Partial<ActionNodeData>) => void;
}) {
  const { data: members = [] } = useTeamMembers();
  const activeMembers = members.filter((member) => member.is_active);
  const selected = activeMembers.find((member) => member.id === data.notifyMemberId);
  const needsWhatsApp = data.notifyChannel === "whatsapp" || data.notifyChannel === "both";

  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="notify-member">Membro da equipe</Label>
        <Select value={data.notifyMemberId || ""} onValueChange={(id) => onUpdate({
          notifyMemberId: id,
          notifyMemberName: activeMembers.find((member) => member.id === id)?.name || "",
        })}>
          <SelectTrigger id="notify-member"><SelectValue placeholder="Selecione o membro da equipe" /></SelectTrigger>
          <SelectContent>
            {activeMembers.map((member) => <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {data.notifyMemberId && !selected && <p role="alert" className="text-xs text-warning">O membro selecionado está indisponível. Escolha um membro ativo.</p>}
      </div>
      <div className="space-y-2">
        <Label htmlFor="notify-message">Mensagem</Label>
        <Textarea id="notify-message" value={data.notifyMessage || ""} onChange={(event) => onUpdate({ notifyMessage: event.target.value })} placeholder="Lead {{nome}} precisa de atenção!" rows={3} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="notify-channel">Canal de Notificação</Label>
        <Select value={data.notifyChannel || "app"} onValueChange={(value) => onUpdate({ notifyChannel: value as "app" | "whatsapp" | "both" })}>
          <SelectTrigger id="notify-channel"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="app">Apenas no App</SelectItem>
            <SelectItem value="whatsapp">WhatsApp</SelectItem>
            <SelectItem value="both">App + WhatsApp</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {needsWhatsApp && <>
        {selected && !selected.phone?.trim() && <p role="alert" className="text-xs text-warning">Cadastre o telefone WhatsApp deste membro em Equipe antes de ativar a automação.</p>}
        <InstanceRoutingSelector data={data} onUpdate={onUpdate} fixedOnly />
      </>}
    </>
  );
}
