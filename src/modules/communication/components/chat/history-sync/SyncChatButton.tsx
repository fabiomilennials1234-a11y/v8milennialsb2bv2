/**
 * SyncChatButton — botão compacto "Sync histórico" para header do chat.
 *
 * Cria job scope=chat com chat_jid da conversa ativa.
 */
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { SyncProgressCard } from "./SyncProgressCard";
import { Button } from "@/components/ui/button";
import { History } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { useCreateHistorySyncJob, useHistorySyncJobs } from "@/modules/communication/hooks/useHistorySyncJobs";
import { notifyError } from "@/shared/errors";

interface Props {
  instanceId: string;
  chatJid: string;
}

/**
 * O diálogo "Histórico desta conversa", sem o gatilho. O cabeçalho do chat o
 * abre a partir do ⋯ (V5); o botão abaixo continua existindo para quem o usa
 * solto.
 */
export function SyncChatDialog({
  instanceId,
  chatJid,
  open,
  onOpenChange,
}: Props & { open: boolean; onOpenChange: (open: boolean) => void }) {
  const createJob = useCreateHistorySyncJob();
  const { data: jobs = [], isLoading, isError } = useHistorySyncJobs({ instanceId, chatJid });
  const active = jobs.some(job => job.status === "queued" || job.status === "running");

  const handleClick = async () => {
    try {
      await createJob.mutateAsync({
        instance_id: instanceId,
        scope: "chat",
        chat_jid: chatJid,
        max_days: 0, // chat scope ignores days cutoff
      });
      toast.success("Sync deste chat agendado");
    } catch (e) {
      notifyError(e, { fallback: "Não foi possível agendar sync." });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Histórico desta conversa</DialogTitle>
          <DialogDescription>Importe as mensagens disponíveis no WhatsApp e acompanhe o andamento.</DialogDescription>
        </DialogHeader>
        <Button onClick={handleClick} disabled={active || createJob.isPending || isLoading || isError}>
          {createJob.isPending ? "Agendando..." : active ? "Importação em andamento" : "Importar mensagens"}
        </Button>
        {isError ? <p role="alert" className="text-sm text-destructive">Não foi possível consultar o andamento. Tente novamente.</p>
          : isLoading ? <p className="text-sm text-muted-foreground">Carregando histórico...</p>
          : jobs.length ? jobs.slice(0, 5).map(job => <SyncProgressCard key={job.id} job={job} />)
          : <p className="text-sm text-muted-foreground">Nenhuma importação registrada nesta conversa.</p>}
      </DialogContent>
    </Dialog>
  );
}

export function SyncChatButton({ instanceId, chatJid }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setOpen(true)}
            aria-label="Sincronizar histórico deste chat"
            className="h-8 w-8"
          >
            <History className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Importar histórico desta conversa</TooltipContent>
      </Tooltip>
    </TooltipProvider>
    {open && <SyncChatDialog instanceId={instanceId} chatJid={chatJid} open={open} onOpenChange={setOpen} />}
    </>
  );
}
