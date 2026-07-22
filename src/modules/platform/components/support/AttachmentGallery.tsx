/**
 * AttachmentGallery — como um Anexo aparece na thread.
 *
 * Imagem tem miniatura, porque é a evidência que se lê de relance. O resto vira
 * card com nome e tamanho e **baixa**: um PDF aberto no visor executa o
 * JavaScript que carrega, e o nome real só existe porque ele mora numa coluna e
 * não no caminho (ADR-0022, 3 e 11).
 *
 * O anexo que a retenção levou não some da conversa: vira lápide. A thread
 * continua dizendo que houve uma evidência ali e que ela expirou — o que a LGPD
 * manda descartar é o arquivo, não o fato de ele ter existido.
 */

import { useState } from "react";
import { toast } from "sonner";
import {
  FileSpreadsheet,
  FileText,
  FileType2,
  Image as ImageIcon,
  Loader2,
  Paperclip,
  ShieldAlert,
  Trash2,
} from "lucide-react";
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
import { cn } from "@/lib/utils";
import {
  attachmentKind,
  avisaFormula,
  formatBytes,
  type AttachmentKind,
} from "@/modules/platform/lib/support-attachments";
import {
  useDeleteTicketAttachment,
  type TicketAttachment,
} from "@/modules/platform/hooks/useTicketAttachments";

const ICONS: Record<AttachmentKind, typeof FileText> = {
  imagem: ImageIcon,
  pdf: FileType2,
  planilha: FileSpreadsheet,
  documento: FileText,
  texto: FileText,
};

function iconOf(mime: string) {
  const kind = attachmentKind(mime);
  return kind ? ICONS[kind] : Paperclip;
}

interface Props {
  attachments: TicketAttachment[];
  className?: string;
  /** Só o master remove um Anexo, como só ele apaga um Chamado. */
  canDelete?: boolean;
  ticketId?: string;
}

export function AttachmentGallery({ attachments, className, canDelete, ticketId }: Props) {
  const remove = useDeleteTicketAttachment();
  const [pendingDelete, setPendingDelete] = useState<TicketAttachment | null>(null);

  if (attachments.length === 0) return null;

  const vivos = attachments.filter((a) => !a.purgedAt);
  const expirados = attachments.filter((a) => a.purgedAt);
  const imagens = vivos.filter((a) => a.previewable);
  const arquivos = vivos.filter((a) => !a.previewable);

  const podeRemover = !!canDelete && !!ticketId;

  async function confirmarRemocao() {
    const alvo = pendingDelete;
    setPendingDelete(null);
    if (!alvo || !ticketId) return;
    try {
      await remove.mutateAsync({ id: alvo.id, path: alvo.path, ticketId });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não deu para remover o anexo.");
    }
  }

  return (
    <div className={cn("space-y-2", className)}>
      {imagens.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {imagens.map((a) => (
            <li key={a.id} className="group relative">
              <a
                href={a.signedUrl}
                target="_blank"
                rel="noreferrer"
                title={a.filename}
                aria-label={`Abrir ${a.filename}`}
              >
                <img
                  src={a.signedUrl}
                  alt={a.filename}
                  className="h-16 w-16 rounded-lg border border-border/60 object-cover transition-opacity hover:opacity-80"
                />
              </a>
              {podeRemover && (
                <button
                  type="button"
                  onClick={() => setPendingDelete(a)}
                  disabled={remove.isPending}
                  aria-label={`Remover ${a.filename}`}
                  className="absolute -right-1.5 -top-1.5 rounded-full border border-border bg-background p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <Trash2 className="h-3 w-3" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {arquivos.length > 0 && (
        <ul className="space-y-1.5">
          {arquivos.map((a) => {
            const Icon = iconOf(a.mime);
            return (
              <li key={a.id} className="flex items-center gap-1">
                <a
                  href={a.signedUrl}
                  // `download` na URL assinada já força o Content-Disposition; o
                  // atributo mantém a intenção explícita no markup.
                  download={a.filename}
                  className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 transition-colors hover:bg-muted/40"
                >
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-foreground">
                      {a.filename}
                    </span>
                    <span className="block text-[11px] text-muted-foreground">
                      {formatBytes(a.sizeBytes)}
                      {avisaFormula(a.mime) && (
                        <>
                          {" · "}
                          <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-500">
                            <ShieldAlert className="h-3 w-3" aria-hidden />
                            confira antes de abrir na planilha
                          </span>
                        </>
                      )}
                    </span>
                  </span>
                </a>
                {podeRemover && (
                  <button
                    type="button"
                    onClick={() => setPendingDelete(a)}
                    disabled={remove.isPending}
                    aria-label={`Remover ${a.filename}`}
                    className="shrink-0 rounded p-1.5 text-muted-foreground transition-colors hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {expirados.map((a) => (
        <p key={a.id} className="flex items-center gap-1.5 text-[11px] italic text-muted-foreground">
          <Paperclip className="h-3 w-3 shrink-0" aria-hidden />
          {a.filename} — removido após 90 dias do fechamento
        </p>
      ))}

      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover este anexo?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.filename} sai do chamado para todo mundo, e não volta. Se alguém já
              abriu o arquivo, essa cópia continua com a pessoa — a remoção impede o acesso daqui
              para a frente, não desfaz o que já foi visto.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Manter</AlertDialogCancel>
            <AlertDialogAction onClick={confirmarRemocao}>
              {remove.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden />}
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
