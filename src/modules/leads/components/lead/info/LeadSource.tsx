/**
 * LeadSource — exibe (e opcionalmente edita) a origem do lead.
 *
 * Criado na Onda 3.1, C3. Editável adicionado em 2026-07-13 (pedido: editar/
 * criar origem). Quando `editable` + `leadId`, renderiza OriginSelect e
 * persiste via useUpdateLead; caso contrário, badge read-only.
 */

import { useQueryClient } from "@tanstack/react-query";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { getOriginLabel } from "@/lib/lead/lead-origins";
import { OriginSelect } from "./OriginSelect";
import { useUpdateLead } from "../../../hooks/useLeads";

interface LeadSourceProps {
  origin?: string | null;
  originDetail?: string | null;
  /** Habilita edição inline da origem. */
  editable?: boolean;
  /** Necessário quando editable=true para persistir. */
  leadId?: string;
}

export function LeadSource({ origin, originDetail, editable, leadId }: LeadSourceProps) {
  const updateLead = useUpdateLead();
  const queryClient = useQueryClient();

  const handleChange = async (slug: string) => {
    if (!leadId) return;
    try {
      // origin virou text no DB (migration 20270214000000); types.ts ainda o
      // tipa como enum lead_origin — cast até o regen.
      await updateLead.mutateAsync({ id: leadId, origin: slug as never });
      queryClient.invalidateQueries({ queryKey: ["lead-detail"] });
      toast.success("Origem atualizada");
    } catch {
      toast.error("Erro ao atualizar origem");
    }
  };

  if (editable && leadId) {
    return (
      <div className="space-y-1.5">
        <Label className="text-xs">Origem</Label>
        <OriginSelect value={origin || null} onChange={handleChange} placeholder="Selecione a origem" />
        {originDetail && (
          <span className="text-xs text-muted-foreground">{originDetail}</span>
        )}
      </div>
    );
  }

  if (!origin) return null;

  return (
    <div className="space-y-1.5">
      <Label className="text-xs">Origem</Label>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="text-xs">
          {getOriginLabel(origin)}
        </Badge>
        {originDetail && (
          <span className="text-xs text-muted-foreground">{originDetail}</span>
        )}
      </div>
    </div>
  );
}
