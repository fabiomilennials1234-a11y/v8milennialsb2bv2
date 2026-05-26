import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useCampanhaViewers,
  useAddCampanhaViewer,
  useRemoveCampanhaViewer,
  type CampanhaViewer,
} from "@/hooks/useCampanhas";
import { useTeamMembers } from "@/modules/identity";
import { useCanDo } from "@/modules/identity";
import { UserPlus, X, Users } from "lucide-react";
import { toast } from "sonner";

interface CampanhaViewersSectionProps {
  campanhaId: string;
}

export function CampanhaViewersSection({ campanhaId }: CampanhaViewersSectionProps) {
  const { allowed: isAdmin } = useCanDo("trigger_campaign");
  const { data: viewers = [] } = useCampanhaViewers(campanhaId);
  const { data: teamMembers = [] } = useTeamMembers();
  const addViewer = useAddCampanhaViewer();
  const removeViewer = useRemoveCampanhaViewer();
  const [selectedMemberId, setSelectedMemberId] = useState<string>("");

  const viewerIds = new Set(viewers.map((v) => v.team_member_id));
  const availableMembers = teamMembers.filter((m) => !viewerIds.has(m.id));

  const handleAdd = async () => {
    if (!selectedMemberId) return;
    try {
      await addViewer.mutateAsync({ campanha_id: campanhaId, team_member_id: selectedMemberId });
      toast.success("Usuário adicionado à visualização");
      setSelectedMemberId("");
    } catch (e) {
      console.error(e);
      toast.error("Erro ao adicionar usuário");
    }
  };

  const handleRemove = async (v: CampanhaViewer) => {
    try {
      await removeViewer.mutateAsync({ id: v.id, campanha_id: campanhaId });
      toast.success("Usuário removido da visualização");
    } catch (e) {
      console.error(e);
      toast.error("Erro ao remover usuário");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Users className="w-4 h-4" />
        Usuários com visualização
      </div>
      <p className="text-xs text-muted-foreground">
        Se nenhum usuário for adicionado, todos os membros da organização podem ver esta campanha.
        Ao adicionar usuários, apenas admins e os listados abaixo terão acesso.
      </p>

      {viewers.length > 0 && (
        <ul className="space-y-2">
          {viewers.map((v) => (
            <li
              key={v.id}
              className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-sm"
            >
              <span>{v.team_member?.name ?? v.team_member_id}</span>
              {isAdmin && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  onClick={() => handleRemove(v)}
                  disabled={removeViewer.isPending}
                >
                  <X className="w-4 h-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {isAdmin && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[200px] space-y-1.5">
            <Label className="text-xs">Adicionar usuário</Label>
            <Select
              value={selectedMemberId}
              onValueChange={setSelectedMemberId}
              disabled={availableMembers.length === 0}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder={availableMembers.length === 0 ? "Todos já adicionados" : "Selecione..."} />
              </SelectTrigger>
              <SelectContent>
                {availableMembers.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={handleAdd}
            disabled={!selectedMemberId || addViewer.isPending}
          >
            <UserPlus className="w-4 h-4 mr-1" />
            Adicionar
          </Button>
        </div>
      )}
    </div>
  );
}
