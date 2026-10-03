/**
 * SyncChatButton — botão compacto "Sync histórico" para header do chat.
 *
 * Cria job scope=chat com chat_jid da conversa ativa.
 */
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { SyncProgressCard } from "./SyncProgressCard";
import { Button } from "@/components/ui/button";
import { History, Loader2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { useCreateHistorySyncJob, useHistorySyncJobs } from "@/modules/communication/hooks/useHistorySyncJobs";

interface Props {
  instanceId: string;
  chatJid: string;
}

export function SyncChatButton({ instanceId, chatJid }: Props) {
  const createJob = useCreateHistorySyncJob();
  const [open, setOpen] = useState(false);
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
      toast.error(`Erro ao agendar sync: ${(e as Error).message}`);
    }
  };

  return (
    <>
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setOpen(true)}
            disabled={createJob.isPending}
            aria-label="Sincronizar histórico deste chat"
            className="h-8 w-8"
          >
            {createJob.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <History className="h-4 w-4" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>Importar histórico desta conversa</TooltipContent>
      </Tooltip>
    </TooltipProvider>
    <Dialog open={open} onOpenChange={setOpen}>
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
    </>
  );
}
