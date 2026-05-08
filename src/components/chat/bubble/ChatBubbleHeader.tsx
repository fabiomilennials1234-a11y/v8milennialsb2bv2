/**
 * ChatBubbleHeader — sticky top, dual-mode.
 *
 * Modo lista: título "Conversas" + minimize + close.
 * Modo thread: back + avatar + nome (truncate) + metadata + minimize + close.
 *
 * Glass blur: fórmula coerente com .topnav-header (src/index.css).
 */
import { ChevronLeft, Minus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { instanceColor } from "./utils/instanceColor";

interface ChatBubbleHeaderProps {
  mode: "list" | "thread";
  // thread-mode props
  contactName?: string;
  instanceName?: string | null;
  showInstanceDot?: boolean;
  instanceId?: string | null;
  // ações
  onBack: () => void;
  onMinimize: () => void;
  onClose: () => void;
}

function getInitials(name: string): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function ChatBubbleHeader({
  mode,
  contactName,
  instanceName,
  showInstanceDot,
  instanceId,
  onBack,
  onMinimize,
  onClose,
}: ChatBubbleHeaderProps) {
  return (
    <div
      className="
        sticky top-0 z-10
        flex items-center gap-2 px-3 h-12
        bg-popover/85 backdrop-blur-xl backdrop-saturate-150
        border-b border-border/40
      "
    >
      {mode === "thread" ? (
        <>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={onBack}
            aria-label="Voltar para conversas"
          >
            <ChevronLeft className="w-4 h-4" aria-hidden />
          </Button>

          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="relative shrink-0">
              <Avatar className="w-8 h-8">
                <AvatarFallback className="bg-muted text-foreground/70 text-xs font-medium">
                  {getInitials(contactName ?? "")}
                </AvatarFallback>
              </Avatar>
              {showInstanceDot && instanceId && (
                <span
                  className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-popover"
                  style={{ backgroundColor: instanceColor(instanceId) }}
                  aria-hidden
                  title={instanceName ?? undefined}
                />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold leading-tight truncate text-foreground">
                {contactName || "Contato"}
              </p>
              {instanceName && (
                <p className="text-[11px] text-muted-foreground/70 truncate">
                  {instanceName}
                </p>
              )}
            </div>
          </div>
        </>
      ) : (
        <p className="flex-1 text-sm font-semibold tracking-tight text-foreground px-1">
          Conversas
        </p>
      )}

      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0"
        onClick={onMinimize}
        aria-label="Minimizar"
      >
        <Minus className="w-4 h-4" aria-hidden />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0"
        onClick={onClose}
        aria-label="Fechar"
      >
        <X className="w-4 h-4" aria-hidden />
      </Button>
    </div>
  );
}
