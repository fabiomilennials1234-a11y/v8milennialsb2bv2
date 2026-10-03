/**
 * AttachmentPicker — escolher arquivos antes de enviar.
 *
 * Controlado: quem usa segura a lista. Os arquivos ficam em memória até o envio
 * porque o caminho no bucket depende do id do Chamado, que na abertura ainda não
 * existe (ADR-0022, 2).
 *
 * A captura dos ids técnicos do Support Context é silenciosa — eles não expõem
 * nada. A do arquivo é **explícita**: um print ou uma planilha do CRM contém
 * nome, telefone e CNPJ dos leads do nosso cliente, e ele merece decidir isso
 * sabendo — inclusive que não poderá desfazer sozinho.
 */

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Paperclip, X } from "lucide-react";
import { ShieldAlert } from "lucide-react";
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
  ATTACHMENTS_PER_COMMENT,
  ATTACHMENT_MIME_TYPES,
  formatBytes,
  validateAttachment,
} from "@/modules/platform/lib/support-attachments";

interface Props {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
  /** Quantos ainda cabem neste Chamado, considerando o que já está lá. */
  remaining?: number;
  label?: string;
}

export function AttachmentPicker({
  files,
  onChange,
  disabled,
  remaining = ATTACHMENTS_PER_COMMENT,
  label = "Anexar",
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<File[] | null>(null);
  const [consentiu, setConsentiu] = useState(false);

  const teto = Math.min(ATTACHMENTS_PER_COMMENT, Math.max(remaining, 0));
  const cheio = files.length >= teto;

  function aceitar(escolhidos: File[]) {
    const cabem = teto - files.length;
    if (escolhidos.length > cabem) {
      toast.error(
        cabem === 0
          ? "Não cabem mais anexos nesta mensagem."
          : `Cabem mais ${cabem} ${cabem === 1 ? "arquivo" : "arquivos"} nesta mensagem.`,
      );
      escolhidos = escolhidos.slice(0, Math.max(cabem, 0));
    }

    const validos: File[] = [];
    for (const f of escolhidos) {
      const check = validateAttachment(f);
      if (!check.ok) {
        toast.error(`${f.name}: ${check.reason}`);
        continue;
      }
      // Mesmo nome e mesmo tamanho já na fila é clique repetido, não segundo
      // arquivo.
      if (files.some((j) => j.name === f.name && j.size === f.size)) continue;
      validos.push(f);
    }

    if (validos.length > 0) onChange([...files, ...validos]);
  }

  function escolher(lista: File[]) {
    if (lista.length === 0) return;
    if (consentiu) {
      aceitar(lista);
      return;
    }
    setPending(lista);
  }

  return (
    <div className="space-y-2">
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {files.map((f, i) => (
            <li
              key={`${f.name}-${f.size}-${i}`}
              className="flex max-w-full items-center gap-1.5 rounded-md border border-border/60 bg-muted/30 py-1 pl-2 pr-1 text-[11px]"
            >
              <span className="truncate text-foreground">{f.name}</span>
              <span className="shrink-0 text-muted-foreground">{formatBytes(f.size)}</span>
              <button
                type="button"
                onClick={() => onChange(files.filter((_, j) => j !== i))}
                disabled={disabled}
                className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label={`Remover ${f.name}`}
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ATTACHMENT_MIME_TYPES.join(",")}
        className="sr-only"
        onChange={(e) => {
          const lista = Array.from(e.target.files ?? []);
          e.target.value = "";
          escolher(lista);
        }}
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="gap-1.5 text-xs"
        disabled={disabled || cheio}
        onClick={() => inputRef.current?.click()}
      >
        <Paperclip className="h-3.5 w-3.5" aria-hidden />
        {label}
      </Button>

      <AlertDialog open={!!pending} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-amber-500" aria-hidden />
              Esse arquivo mostra dados dos seus clientes?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Uma tela ou uma planilha do CRM costuma trazer nome, telefone e CNPJ dos seus leads. O
              suporte da Torque vai ver o arquivo. Ele fica guardado com acesso restrito, o link
              expira em minutos, e é apagado 90 dias depois que o chamado fecha — mas, uma vez
              enviado, só o suporte consegue removê-lo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Não enviar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const lista = pending ?? [];
                setPending(null);
                setConsentiu(true);
                aceitar(lista);
              }}
            >
              Enviar mesmo assim
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
