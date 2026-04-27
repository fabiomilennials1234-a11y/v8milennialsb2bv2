/**
 * InteractiveResponseBubble — renderiza respostas de menu interativo
 * enviado via sendMenu (button/list/poll).
 *
 * Uazapi webhook payload para `messages` com type=buttonResponseMessage
 * ou listResponseMessage inclui a opção escolhida em `data.selected` ou
 * content.
 */
import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  content: string | null;
  messageType: string;
  isOutgoing: boolean;
}

export function InteractiveResponseBubble({
  content,
  messageType,
  isOutgoing,
}: Props) {
  const isButtonResponse =
    messageType === "buttonResponse" ||
    messageType === "buttonResponseMessage";
  const isListResponse =
    messageType === "listResponse" || messageType === "listResponseMessage";
  const isPollUpdate =
    messageType === "pollUpdate" || messageType === "pollUpdateMessage";

  if (!isButtonResponse && !isListResponse && !isPollUpdate) return null;

  const label = isButtonResponse
    ? "Selecionou (botão)"
    : isListResponse
    ? "Selecionou (lista)"
    : "Votou";

  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md border border-border/40 px-2 py-1.5",
        isOutgoing ? "bg-primary/5" : "bg-muted/40"
      )}
    >
      <CheckCircle2 className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
          {label}
        </p>
        <p className="text-sm break-words">{content ?? "—"}</p>
      </div>
    </div>
  );
}
