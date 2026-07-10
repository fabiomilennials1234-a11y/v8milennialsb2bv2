import { useRef, useState } from "react";
import { toast } from "sonner";
import { ImagePlus, Loader2, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  useTicketAttachments,
  useUploadTicketAttachment,
} from "@/modules/platform/hooks/useTicketAttachments";
import { ATTACHMENT_MIME_TYPES } from "@/modules/platform/lib/support-attachments";

/**
 * Anexos de um Chamado.
 *
 * A captura dos ids técnicos é silenciosa — eles não expõem nada. A do print é
 * **explícita**: um print da tela do CRM contém nome, telefone e CNPJ dos leads
 * do nosso cliente, e ele merece decidir isso sabendo (ADR-0018).
 */
export function AttachmentStrip({ ticketId, canAttach }: { ticketId: string; canAttach: boolean }) {
  const { data: attachments = [] } = useTicketAttachments(ticketId);
  const upload = useUploadTicketAttachment();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<File | null>(null);

  async function confirmar() {
    const file = pending;
    setPending(null);
    if (!file) return;

    try {
      await upload.mutateAsync({ ticketId, file });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não deu para anexar.");
    }
  }

  if (attachments.length === 0 && !canAttach) return null;

  return (
    <div className="space-y-2">
      {attachments.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {attachments.map((a) => (
            <li key={a.path}>
              <a href={a.signedUrl} target="_blank" rel="noreferrer">
                <img
                  src={a.signedUrl}
                  alt="Anexo do chamado"
                  className="h-16 w-16 rounded-lg border border-border/60 object-cover transition-opacity hover:opacity-80"
                />
              </a>
            </li>
          ))}
        </ul>
      )}

      {canAttach && (
        <>
          <input
            ref={inputRef}
            type="file"
            accept={ATTACHMENT_MIME_TYPES.join(",")}
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) setPending(file);
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1.5 text-xs"
            disabled={upload.isPending}
            onClick={() => inputRef.current?.click()}
          >
            {upload.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <ImagePlus className="h-3.5 w-3.5" aria-hidden />
            )}
            Anexar print
          </Button>
        </>
      )}

      <AlertDialog open={!!pending} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-amber-500" aria-hidden />
              Esse print mostra dados dos seus clientes?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Uma captura de tela do CRM costuma trazer nome, telefone e CNPJ dos seus leads. O
              suporte da Torque vai ver a imagem. Ela fica guardada com acesso restrito e o link
              expira em minutos — mas a decisão de enviar é sua.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Não enviar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmar}>Enviar mesmo assim</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
