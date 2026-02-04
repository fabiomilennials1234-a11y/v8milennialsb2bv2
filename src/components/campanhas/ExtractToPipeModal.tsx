import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useExtractLeadToPipe, type CampanhaLead, type ExtractLeadToPipeTarget } from "@/hooks/useCampanhas";
import { useOrganization } from "@/hooks/useOrganization";
import { MessageSquare, CalendarCheck, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";

const PIPE_OPTIONS: { target: ExtractLeadToPipeTarget; label: string; icon: typeof MessageSquare }[] = [
  { target: "pipe_whatsapp", label: "Pipe WhatsApp (SDR)", icon: MessageSquare },
  { target: "pipe_confirmacao", label: "Pipe Confirmação", icon: CalendarCheck },
  { target: "pipe_propostas", label: "Pipe Propostas", icon: FileText },
];

interface ExtractToPipeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: CampanhaLead | null;
  campanhaId: string;
  campanhaName: string;
  organizationId: string | null;
  onSuccess?: () => void;
}

export function ExtractToPipeModal({
  open,
  onOpenChange,
  lead,
  campanhaId,
  campanhaName,
  organizationId,
  onSuccess,
}: ExtractToPipeModalProps) {
  const extract = useExtractLeadToPipe();

  if (!lead) return null;

  const handleExtract = async (target: ExtractLeadToPipeTarget) => {
    if (!organizationId) {
      toast.error("Organização não definida");
      return;
    }
    try {
      await extract.mutateAsync({
        campanha_lead_id: lead.id,
        campanha_id: campanhaId,
        lead_id: lead.lead_id,
        target_pipe: target,
        organization_id: organizationId,
        sdr_id: lead.sdr_id ?? undefined,
        closer_id: lead.lead?.closer_id ?? undefined,
        campaign_name: campanhaName,
      });
      const pipeLabel = PIPE_OPTIONS.find((o) => o.target === target)?.label ?? target;
      toast.success(`Lead enviado para ${pipeLabel} e removido da campanha`);
      onOpenChange(false);
      onSuccess?.();
    } catch (e) {
      console.error(e);
      toast.error("Erro ao enviar lead para o pipe");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Enviar lead para pipe</DialogTitle>
          <DialogDescription>
            O lead <strong>{lead.lead?.name}</strong> sairá desta campanha e entrará no pipe escolhido.
            Escolha o destino:
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 py-2">
          {PIPE_OPTIONS.map(({ target, label, icon: Icon }) => (
            <Button
              key={target}
              type="button"
              variant="outline"
              className="justify-start gap-3 h-auto py-3"
              onClick={() => handleExtract(target)}
              disabled={extract.isPending}
            >
              {extract.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin shrink-0" />
              ) : (
                <Icon className="w-4 h-4 shrink-0" />
              )}
              {label}
            </Button>
          ))}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
