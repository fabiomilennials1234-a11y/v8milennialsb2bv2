/**
 * ChatQuickActions — a régua de ferramentas do compositor.
 *
 * V5 (02/10): deixou de ser uma fileira solta ACIMA do campo — que repetia os
 * botões de dentro dele — e virou o andar de baixo do compositor de dois
 * andares (campo em cima, ferramentas embaixo, enviar à direita).
 *
 * Os três botões de sempre (anexar, gravar áudio, template rápido) moram aqui;
 * as ferramentas que dependem do provedor (agendar, contato/localização, menu
 * interativo, Pix) entram por `children`, entre o áudio e o template.
 *
 * Touch targets: min 44x44px. Ícones neutros, mais claros no hover.
 */
import type { ReactNode } from "react";
import { Mic, FileText, Paperclip } from "lucide-react";
import { cn } from "@/lib/utils";
import { QUICK_ACTION_BUTTON } from "./quick-action-button";

export interface ChatQuickActionsProps {
  onAudio: () => void;
  onTemplate: () => void;
  onAttach: () => void;
  disabled?: boolean;
  /** Ferramentas extras, entre o áudio e o template. */
  children?: ReactNode;
  className?: string;
}


export function ChatQuickActions({
  onAudio,
  onTemplate,
  onAttach,
  disabled = false,
  children,
  className,
}: ChatQuickActionsProps) {
  return (
    <div
      className={cn("flex min-w-0 items-center", className)}
      role="toolbar"
      aria-label="Ações rápidas"
    >
      <button
        type="button"
        onClick={onAttach}
        disabled={disabled}
        aria-label="Anexar arquivo"
        title="Anexar imagem, vídeo ou documento"
        className={QUICK_ACTION_BUTTON}
      >
        <Paperclip className="w-[18px] h-[18px]" />
      </button>

      <button
        type="button"
        onClick={onAudio}
        disabled={disabled}
        aria-label="Gravar áudio"
        title="Gravar áudio"
        className={QUICK_ACTION_BUTTON}
      >
        <Mic className="w-[18px] h-[18px]" />
      </button>

      {children}

      <button
        type="button"
        onClick={onTemplate}
        disabled={disabled}
        aria-label="Template rápido"
        title="Template rápido (⌘K)"
        className={QUICK_ACTION_BUTTON}
      >
        <FileText className="w-[18px] h-[18px]" />
      </button>
    </div>
  );
}
