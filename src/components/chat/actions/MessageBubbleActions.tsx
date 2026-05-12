/**
 * MessageBubbleActions — barra de 5 ações (react/edit/pin/delete/markRead)
 * revelada em hover no MessageBubble.
 *
 * Wiring:
 *  - Props recebem instanceId + messageId + number (remote_jid stripped) +
 *    direction ("incoming"|"outgoing") + permissions (podeEditar/Deletar).
 *  - Hooks useMessageActions executam mutations.
 *  - Erros NotSupportedError (instance=evolution) → toast informativo.
 */
import { useState } from "react";
import { Pencil, Pin, Trash2, Check, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

import {
  useReactMessage,
  useEditMessage,
  usePinMessage,
  useDeleteMessage,
  useMarkMessageRead,
  useDownloadMedia,
  isFeatureUnavailable,
} from "@/hooks/useMessageActions";
import { EmojiPickerPopover } from "./EmojiPickerPopover";
import { DeleteMessageConfirm } from "./DeleteMessageConfirm";

export interface MessageBubbleActionsProps {
  instanceId: string;
  messageId: string;
  /** Phone number (digits only) — remote_jid split at "@" */
  number: string;
  direction: "incoming" | "outgoing";
  /** Only outgoing messages from this instance can be edited/deleted */
  canEdit: boolean;
  canDelete: boolean;
  /** true when this message is currently pinned */
  isPinned: boolean;
  /** true when message has downloadable media (image/video/audio/doc) */
  hasMedia?: boolean;
  /** Fired when user clicks the edit pencil — parent swaps to EditMessageInline */
  onRequestEdit: () => void;
  className?: string;
}

export function MessageBubbleActions({
  instanceId,
  messageId,
  number,
  direction,
  canEdit,
  canDelete,
  isPinned,
  hasMedia,
  onRequestEdit,
  className,
}: MessageBubbleActionsProps) {
  const reactMut = useReactMessage();
  const pinMut = usePinMessage();
  const deleteMut = useDeleteMessage();
  const markReadMut = useMarkMessageRead();
  const downloadMut = useDownloadMedia();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const handleError = (err: unknown, fallback: string) => {
    if (isFeatureUnavailable(err)) {
      toast.error("Disponível apenas em instâncias Uazapi");
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    toast.error(`${fallback}: ${msg}`);
  };

  const handleReact = async (emoji: string) => {
    try {
      await reactMut.mutateAsync({ instanceId, messageId, number, emoji });
    } catch (e) {
      handleError(e, "Erro ao reagir");
    }
  };

  const handlePin = async () => {
    try {
      await pinMut.mutateAsync({ instanceId, messageId, number });
      toast.success(isPinned ? "Mensagem desafixada" : "Mensagem fixada");
    } catch (e) {
      handleError(e, "Erro ao fixar");
    }
  };

  const handleMarkRead = async () => {
    try {
      await markReadMut.mutateAsync({ instanceId, messageId, number });
      toast.success("Marcada como lida");
    } catch (e) {
      handleError(e, "Erro ao marcar como lida");
    }
  };

  const handleDownload = async () => {
    try {
      const { base64, mimetype } = await downloadMut.mutateAsync({ instanceId, messageId });
      const link = document.createElement("a");
      link.href = `data:${mimetype};base64,${base64}`;
      const ext = mimetype.split("/")[1]?.split(";")[0] ?? "bin";
      link.download = `media-${messageId.slice(0, 8)}.${ext}`;
      link.click();
      toast.success("Download iniciado");
    } catch (e) {
      handleError(e, "Erro ao baixar mídia");
    }
  };

  const handleDelete = async () => {
    try {
      await deleteMut.mutateAsync({ instanceId, messageId, number });
      setDeleteOpen(false);
      toast.success("Mensagem apagada");
    } catch (e) {
      handleError(e, "Erro ao apagar");
    }
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div
        className={cn(
          "flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity rounded-lg bg-background/95 backdrop-blur shadow-sm border border-border/40 px-1 py-0.5",
          className
        )}
        role="group"
        aria-label="Ações da mensagem"
      >
        <EmojiPickerPopover onSelect={handleReact} disabled={reactMut.isPending} />

        {canEdit && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={onRequestEdit}
                aria-label="Editar mensagem"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Editar</TooltipContent>
          </Tooltip>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={handlePin}
              disabled={pinMut.isPending}
              aria-label={isPinned ? "Desafixar mensagem" : "Fixar mensagem"}
            >
              <Pin className={cn("h-3.5 w-3.5", isPinned && "fill-current text-primary")} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{isPinned ? "Desafixar" : "Fixar"}</TooltipContent>
        </Tooltip>

        {hasMedia && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={handleDownload}
                disabled={downloadMut.isPending}
                aria-label="Baixar mídia"
              >
                <Download className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Baixar mídia</TooltipContent>
          </Tooltip>
        )}

        {direction === "incoming" && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={handleMarkRead}
                disabled={markReadMut.isPending}
                aria-label="Marcar como lida"
              >
                <Check className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Marcar como lida</TooltipContent>
          </Tooltip>
        )}

        {canDelete && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-destructive hover:text-destructive"
                onClick={() => setDeleteOpen(true)}
                disabled={deleteMut.isPending}
                aria-label="Apagar mensagem"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Apagar para todos</TooltipContent>
          </Tooltip>
        )}
      </div>

      <DeleteMessageConfirm
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={handleDelete}
        isPending={deleteMut.isPending}
      />
    </TooltipProvider>
  );
}
