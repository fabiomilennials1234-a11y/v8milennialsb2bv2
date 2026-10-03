// src/components/chat-meta/MetaWindowWarning.tsx
import { AlertTriangle } from "lucide-react";
import { isWithin24hWindow } from "@/modules/communication/hooks/chat-meta/types";

interface Props {
  lastInboundAt: string | null | undefined;
}

export function MetaWindowWarning({ lastInboundAt }: Props) {
  if (!lastInboundAt) return null;
  if (isWithin24hWindow(lastInboundAt)) return null;

  return (
    <div className="flex items-center gap-2 border-t bg-warning/10 px-4 py-2 text-xs text-warning-foreground">
      <AlertTriangle className="h-4 w-4 text-warning shrink-0" />
      <span>
        Janela de 24 horas fechada. Aguarde o cliente enviar uma nova mensagem para responder.
      </span>
    </div>
  );
}
