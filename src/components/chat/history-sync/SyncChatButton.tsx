/**
 * SyncChatButton — botão compacto "Sync histórico" para header do chat.
 *
 * Cria job scope=chat com chat_jid da conversa ativa.
 */
import { Button } from "@/components/ui/button";
import { History, Loader2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { useCreateHistorySyncJob } from "@/hooks/useHistorySyncJobs";

interface Props {
  instanceId: string;
  chatJid: string;
}

export function SyncChatButton({ instanceId, chatJid }: Props) {
  const createJob = useCreateHistorySyncJob();

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
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleClick}
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
  );
}
