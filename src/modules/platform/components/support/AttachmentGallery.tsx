/**
 * AttachmentGallery — como um Anexo aparece na thread.
 *
 * Imagem tem miniatura, porque é a evidência que se lê de relance. O resto vira
 * card com nome e tamanho e **baixa**: um PDF aberto no visor executa o
 * JavaScript que carrega, e o nome real só existe porque ele mora numa coluna e
 * não no caminho (ADR-0022, 3 e 11).
 */

import { FileSpreadsheet, FileText, FileType2, Paperclip, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/modules/platform/lib/support-attachments";
import type { TicketAttachment } from "@/modules/platform/hooks/useTicketAttachments";

const PLANILHA = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const DOCUMENTO = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function iconOf(mime: string) {
  if (mime === "application/pdf") return FileType2;
  if (mime === PLANILHA || mime === "text/csv") return FileSpreadsheet;
  if (mime === DOCUMENTO || mime === "text/plain") return FileText;
  return Paperclip;
}

/**
 * Uma planilha cujo primeiro caractere de célula é `=` executa fórmula quando
 * abre no Excel, e quem abre é o time que tem acesso a todas as organizações. O
 * risco foi aceito conscientemente; o aviso é a contrapartida (ADR-0022).
 */
function riscoDeFormula(mime: string): boolean {
  return mime === "text/csv";
}

export function AttachmentGallery({
  attachments,
  className,
}: {
  attachments: TicketAttachment[];
  className?: string;
}) {
  if (attachments.length === 0) return null;

  const imagens = attachments.filter((a) => a.previewable);
  const arquivos = attachments.filter((a) => !a.previewable);

  return (
    <div className={cn("space-y-2", className)}>
      {imagens.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {imagens.map((a) => (
            <li key={a.id}>
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
            </li>
          ))}
        </ul>
      )}

      {arquivos.length > 0 && (
        <ul className="space-y-1.5">
          {arquivos.map((a) => {
            const Icon = iconOf(a.mime);
            return (
              <li key={a.id}>
                <a
                  href={a.signedUrl}
                  // `download` na URL assinada já força o Content-Disposition; o
                  // atributo mantém a intenção explícita no markup.
                  download={a.filename}
                  className="flex items-center gap-2.5 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 transition-colors hover:bg-muted/40"
                >
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-foreground">
                      {a.filename}
                    </span>
                    <span className="block text-[11px] text-muted-foreground">
                      {formatBytes(a.sizeBytes)}
                      {riscoDeFormula(a.mime) && (
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
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
