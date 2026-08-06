/**
 * "Conversas excluídas" — a saída que faltava para o soft delete do chat.
 *
 * Excluir conversa gravava `deleted_at`, e `get_whatsapp_conversation_list`
 * filtra `deleted_at IS NULL`. Como nada no produto devolvia esse campo para
 * NULL, a exclusão era definitiva: nem desfazer, nem enxergar o que foi
 * excluído. Pior, o `whatsapp-webhook` segue gravando em `whatsapp_messages`
 * normalmente — a conversa continuava RECEBENDO, calada. Medido em prod
 * (2026-08-06): 12 conversas assim, 4 orgs, 897 mensagens invisíveis; numa
 * delas, 504 chegaram depois da exclusão.
 *
 * Por isso a peça mostra a CONTAGEM DE MENSAGENS: é o que responde "isso aqui
 * era lixo ou é conversa de cliente?" antes de restaurar.
 *
 * Só admin vê — a exclusão é gated por `is_user_admin()` dentro de
 * `soft_delete_whatsapp_conversation`, e a restauração usa o mesmo portão em
 * `restore_whatsapp_conversation`. O pai não deve montar este componente para
 * não-admin (assim as queries nem saem).
 */
import { useState } from "react";
import { Trash2, RotateCcw, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  useDeletedConversations,
  useRestoreConversation,
} from "@/modules/communication/hooks/useWhatsAppConversations";

interface DeletedConversationsPanelProps {
  instanceId: string | null;
}

function formatDeletedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function DeletedConversationsPanel({ instanceId }: DeletedConversationsPanelProps) {
  const [open, setOpen] = useState(false);
  const { data: deleted = [], isLoading } = useDeletedConversations(instanceId);
  const restore = useRestoreConversation();
  const [restoringId, setRestoringId] = useState<string | null>(null);

  // Sem nada excluído, nem o gatilho aparece — a barra lateral do inbox não
  // ganha ruído permanente por causa de um caso raro.
  if (deleted.length === 0) return null;

  const handleRestore = async (id: string, phone: string) => {
    setRestoringId(id);
    try {
      await restore.mutateAsync({ conversationId: id });
      toast.success("Conversa restaurada", {
        description: `${phone} voltou para a lista.`,
      });
    } catch (e) {
      // A RPC recusa quem não é admin — a mensagem dela é a mais útil aqui.
      toast.error("Não foi possível restaurar", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 flex w-full items-center justify-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <Trash2 className="h-3 w-3" />
        {deleted.length === 1
          ? "1 conversa excluída"
          : `${deleted.length} conversas excluídas`}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Conversas excluídas</DialogTitle>
            <DialogDescription>
              Elas não aparecem no inbox, mas continuam recebendo mensagem. Restaurar devolve
              a conversa e todo o histórico dela.
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="max-h-[60vh]">
            <div className="space-y-2 pr-3">
              {isLoading ? (
                <div className="flex justify-center py-6">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                deleted.map((conv) => (
                  <div
                    key={conv.id}
                    className="flex items-center justify-between gap-3 rounded-md border border-border/60 p-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{conv.phone_number}</p>
                      <p className="text-xs text-muted-foreground">
                        Excluída em {formatDeletedAt(conv.deleted_at)}
                        {conv.message_count > 0 && (
                          <>
                            {" · "}
                            {conv.message_count === 1
                              ? "1 mensagem"
                              : `${conv.message_count} mensagens`}
                          </>
                        )}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={restoringId === conv.id}
                      onClick={() => handleRestore(conv.id, conv.phone_number)}
                    >
                      {restoringId === conv.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RotateCcw className="h-3.5 w-3.5" />
                      )}
                      <span className="ml-1.5">Restaurar</span>
                    </Button>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}
